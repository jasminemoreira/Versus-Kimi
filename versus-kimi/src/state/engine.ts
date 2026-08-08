// State Engine — manages persistent methodology state

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  PhaseState,
  Decision,
  ExitCriterionState,
  ScoreBreakdown,
  ProjectSpec,
  SpecItem,
  specValue,
  SpecsStatus,
  TransitionError,
  IterationInfo,
  Result,
  createDefaultState,
  SafeguardState,
} from "./types";
import {
  isValidTransition,
  getExitCriteriaForPhase,
  CRITERION_ID_MIGRATION,
} from "../rules/phases";
import {
  SafeguardResult,
  validateSafeguard,
  getSafeguardsForPhase,
  LOOP_FAILURE_THRESHOLD,
  DIAGNOSIS_CATEGORIES,
} from "../rules/safeguards";

export { LOOP_FAILURE_THRESHOLD, DIAGNOSIS_CATEGORIES };

interface ValidationResult {
  valid: boolean;
  missingCriteria: string[];
  safeguardViolations: string[];
}

function validatePhaseTransition(
  from: number,
  to: number,
  state: PhaseState,
  exitCriteriaMet: Map<string, boolean>
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    missingCriteria: [],
    safeguardViolations: [],
  };

  if (!isValidTransition(from, to)) {
    result.valid = false;
    result.missingCriteria.push(
      `Transition from Phase ${from} to Phase ${to} is not allowed. Valid transitions: sequential or loop 2↔3.`
    );
    return result;
  }

  if (to > from) {
    const criteria = getExitCriteriaForPhase(from);
    for (const criterion of criteria) {
      if (criterion.required && !exitCriteriaMet.get(criterion.criterion)) {
        result.valid = false;
        result.missingCriteria.push(
          `[Phase ${from}] ${criterion.criterion}: ${criterion.description}`
        );
      }
    }
  }

  if (from === 0 && to === 1) {
    if (state.phase0Score === null || state.phase0Score < 90) {
      result.valid = false;
      result.missingCriteria.push(
        `Phase 0 score = ${state.phase0Score ?? "null"}. Required >= 90.`
      );
    }
  }

  const safeguards = getSafeguardsForPhase(from);
  for (const safeguard of safeguards) {
    const check = validateSafeguard(safeguard.id, state);
    if (check.status === "violated") {
      result.valid = false;
      result.safeguardViolations.push(`${safeguard.id}: ${check.details}`);
    }
  }

  return result;
}

export class StateEngine {
  private state: PhaseState | null = null;
  private statePath: string;
  private specsPath: string;

  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.statePath = path.join(workspacePath, ".versus", "state.json");
    this.specsPath = path.join(workspacePath, "specs");
  }

  getWorkspace(): string {
    return this.workspacePath;
  }

  // --- Lifecycle ---

  load(): PhaseState | null {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, "utf-8");
        this.state = JSON.parse(raw) as PhaseState;
        this.migrateCriterionIds();
        return this.state;
      }
    } catch (err) {
      // state.json corrupted — returns null
    }
    return null;
  }

  /** Migrate Portuguese criterion IDs to English (v0.3.5 → v0.3.6) */
  private migrateCriterionIds(): void {
    if (!this.state) return;
    let changed = false;
    for (const c of this.state.exitCriteria) {
      const newId = CRITERION_ID_MIGRATION[c.criterion];
      if (newId) {
        c.criterion = newId;
        changed = true;
      }
    }
    for (const h of this.state.history) {
      if (h.criteriaMet) {
        h.criteriaMet = h.criteriaMet.map((id) => CRITERION_ID_MIGRATION[id] || id);
      }
    }
    if (changed) {
      this.save();
    }
  }

  private save(): void {
    if (!this.state) return;
    this.state.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  // --- Project ---

  initProject(name: string, description: string): PhaseState {
    this.state = createDefaultState(name, description);
    this.save();
    return this.state;
  }

  // --- Gateway Guard ---

  touchPhaseStateCheck(): void {
    if (!this.state) return;
    this.state.lastPhaseStateCheck = new Date().toISOString();
    this.save();
  }

  isContextStale(thresholdMinutes = 30): boolean {
    if (!this.state) return true;
    if (!this.state.lastPhaseStateCheck) return true;
    const last = new Date(this.state.lastPhaseStateCheck).getTime();
    return (Date.now() - last) > thresholdMinutes * 60 * 1000;
  }

  // --- Query ---

  getPhaseState(): PhaseState | null {
    if (!this.state) this.load();
    return this.state;
  }

  getDecisions(phase?: number): Decision[] {
    if (!this.state) return [];
    if (phase !== undefined) {
      return this.state.decisions.filter((d) => d.phase === phase);
    }
    return this.state.decisions;
  }

  getExitCriteriaState(phase: number): ExitCriterionState[] {
    if (!this.state) return [];
    return this.state.exitCriteria.filter((c) => c.phase === phase);
  }

  getExitCriteriaWithDefs(phase: number): Array<{ criterion: string; description: string; met: boolean; details?: string }> {
    const defs = getExitCriteriaForPhase(phase);
    const states = this.getExitCriteriaState(phase);
    return defs.map((def) => {
      const state = states.find((s) => s.criterion === def.criterion);
      return {
        criterion: def.criterion,
        description: def.description,
        met: state?.met ?? false,
        details: state?.details,
      };
    });
  }

  // --- Transitions ---

  /**
   * True if a specs/ artifact exists and has non-trivial content. This is the
   * forensic bar: not "is it good" (the oracle — unmechanizable) but "does a
   * persisted, inspectable record exist" — so a stamped gate leaves a trace to
   * audit after a failure instead of vanishing in the chat. relPath is relative
   * to specs/.
   */
  artifactPresent(relPath: string): boolean {
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return false;
      const content = fs.readFileSync(full, "utf-8").replace(/\s/g, "");
      return content.length >= 80;
    } catch {
      return false;
    }
  }

  /** Module names in the 2nd column of table rows whose 1st cell matches idPattern.
   *  Used to extract the module set from architecture.md (M-\d+ rows) and from the
   *  coverage matrix (finding-id rows). Normalized (trim + lowercase) for comparison. */
  private tableColumn2(relPath: string, idPattern: string): Set<string> {
    const out = new Set<string>();
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return out;
      const text = fs.readFileSync(full, "utf-8");
      const re = new RegExp(`\\|\\s*(?:${idPattern})\\s*\\|\\s*([^|]+?)\\s*\\|`, "gm");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const v = m[1].trim().toLowerCase();
        if (v) out.add(v);
      }
    } catch { /* telemetry never blocks */ }
    return out;
  }

  /**
   * Drift between the coverage matrix and the architecture: every module a finding
   * cites must appear in architecture.md's module table, in SOME version. The union
   * of all `## V(N)` module tables tolerates a module removed in a later iteration
   * (its earlier findings are legitimate) while catching a name that was never a
   * module — which breaks the matrix's per-module traceability silently. Skips when
   * either artifact is absent/empty (other gates handle that). Case-insensitive.
   */
  private moduleTraceabilityErrors(): string[] {
    const arch = this.tableColumn2("technical/architecture.md", "M-\\d+");
    const matrix = this.tableColumn2("design/coverage-matrix.md", "(?!M-)[A-Za-z]{1,4}-\\d+");
    if (arch.size === 0 || matrix.size === 0) return [];
    const drift = [...matrix].filter((mod) => !arch.has(mod));
    if (drift.length === 0) return [];
    return [
      `[Phase 2] coverage_matrix cites module(s) absent from every version of the architecture table: ${drift.join(", ")}. ` +
      `Each module in a finding row must appear in specs/technical/architecture.md's module table (any \`## V(N)\` version). ` +
      `Either the name drifted — fix it to the Phase-1 module name — or the architecture is missing the module. ` +
      `Left unfixed, those findings point at modules no artifact records, and per-module traceability breaks after the session.`
    ];
  }
  /** How many lines of a specs/ artifact match `pattern`. Used for structural
   *  gates (e.g. per-finding rows in the coverage matrix). Form, not content. */
  countArtifactRows(relPath: string, pattern: string): number {
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return 0;
      const text = fs.readFileSync(full, "utf-8");
      const re = new RegExp(pattern, "gm");
      return (text.match(re) || []).length;
    } catch {
      return 0;
    }
  }

  /** True if the test-outcome hook witnessed a passing run in `phase`. Gates
   *  tests_passing: the engine saw the green run, it was not merely asserted. */
  witnessedTestPass(phase: number): boolean {
    const t = this.state?.lastTestOutcome;
    return !!t && t.outcome === "pass" && t.phase === phase;
  }




  /**
   * Finding rows of the coverage matrix, grouped by the iteration section they sit
   * under. A matrix with no iteration header yields a single group numbered 1.
   */
  matrixFindingsByIteration(relPath = "design/coverage-matrix.md"): Array<{ iteration: number; modules: string[] }> {
    const groups: Array<{ iteration: number; modules: string[] }> = [];
    let current: { iteration: number; modules: string[] } | undefined;
    try {
      const full = path.join(this.specsPath, relPath);
      if (!fs.existsSync(full)) return groups;
      for (const line of fs.readFileSync(full, "utf-8").split("\n")) {
        const header = line.match(/^\s*##.*?itera(?:[cç][aã]o|tion)\s*(\d+)/i);
        if (header) {
          current = { iteration: parseInt(header[1], 10), modules: [] };
          groups.push(current);
          continue;
        }
        const row = line.match(/^\s*\|\s*(?!M-)([A-Za-z]{1,4}-\d+)\s*\|\s*([^|]+?)\s*\|/);
        if (!row) continue;
        if (!current) {
          current = { iteration: 1, modules: [] };
          groups.push(current);
        }
        const name = row[2].trim().toLowerCase();
        if (name) current.modules.push(name);
      }
    } catch { /* unreadable — treat as empty */ }
    return groups;
  }

  /**
   * Cross-check for Phase 2: every module named by the CURRENT iteration's findings
   * must exist in the architecture version now in force.
   *
   * Earlier iterations are deliberately tolerated. The 2↔3 loop critiques a
   * different architecture each round, so a finding from iteration 1 legitimately
   * names a module V(2) removed — a naive check would block every project whose
   * design evolved, which is the normal case, not the exception.
   */
  /**
   * Phase 2 gate: from iteration 2 on, the coverage matrix must head each round
   * with its iteration. Without the header every finding is silently read as
   * iteration 1 and the link between a finding and the architecture it was made
   * against is lost — and silence is exactly what a gate is for.
   *
   * This checks the header only. Cross-checking that each finding's module exists
   * in the architecture table is deliberately NOT done here: it is deferred, so
   * that a project of the batch is never blocked by a rule the analysis side is
   * not yet ready to consume.
   */
  private requireIterationHeader(): string[] {
    const out: string[] = [];
    const groups = this.matrixFindingsByIteration();
    if (groups.length === 0) return out;

    const iteration = this.state?.currentIteration ?? 1;
    if (iteration > 1 && !groups.some((g) => g.iteration > 1)) {
      out.push(
        `[Phase 2] coverage_matrix: the project is on iteration ${iteration}, but specs/design/coverage-matrix.md ` +
        `has no iteration section header — every finding would silently be read as iteration 1. ` +
        `Head each round's rows with '## Iteração N — V(N)' (or '## Iteration N') so a finding can be traced to the architecture it was made against.`
      );
    }
    return out;
  }


  /**
   * Messages for required criteria of `phase` whose persisted/witnessed evidence
   * is missing — empty means all evidence is present. Shared by advancePhase and
   * startNewCycle so a stamped criterion cannot open either gate without leaving
   * an inspectable trace. Does NOT judge quality (that is the oracle — human).
   */
  private missingEvidence(phase: number): string[] {
    const out: string[] = [];
    for (const def of getExitCriteriaForPhase(phase)) {
      if (!def.required) continue;
      if (def.artifact && !this.artifactPresent(def.artifact)) {
        out.push(
          `[Phase ${phase}] ${def.criterion}: required artifact specs/${def.artifact} is missing or empty. ` +
          `Write the structured artifact to disk — marking the criterion met is not enough; the record must survive the session and be inspectable later.`
        );
      } else if (def.artifact && def.artifactRows && this.countArtifactRows(def.artifact, def.artifactRows.pattern) < def.artifactRows.count) {
        const eg = def.artifactRows.example ? `, e.g. '${def.artifactRows.example}'` : "";
        out.push(
          `[Phase ${phase}] ${def.criterion}: specs/${def.artifact} exists but is not in the required structured form ` +
          `(needs at least ${def.artifactRows.count} table row(s) with an id${eg}). ` +
          `A prose or id-less file cannot be machine-read — each row needs its own id.`
        );
      }
      if (def.verify === "test-pass" && !this.witnessedTestPass(phase)) {
        out.push(
          `[Phase ${phase}] ${def.criterion}: the engine did not witness a passing test run in this phase. ` +
          `Run your test suite so the result is verified by the test-outcome hook (S4: never assume tests passed — execute and verify). ` +
          `Marking the criterion met is not enough.`
        );
      }
    }
    if (phase === 2) out.push(...this.requireIterationHeader());

    return out;
  }

  advancePhase(targetPhase: number): Result<void, TransitionError> {
    if (!this.state) {
      return { ok: false, error: { message: "Project not initialized.", missingCriteria: [] } };
    }

    const from = this.state.currentPhase;
    const exitCriteriaMet = new Map<string, boolean>();
    for (const c of this.state.exitCriteria) {
      if (c.phase === from) {
        exitCriteriaMet.set(c.criterion, c.met);
      }
    }

    const validation = validatePhaseTransition(from, targetPhase, this.state, exitCriteriaMet);

    // Check specs/ (warning, does not block)
    const specsWarnings: string[] = [];
    if (targetPhase >= 1) {
      const specsStatus = this.checkSpecsStatus();
      const expectedDirs = this.getExpectedSpecsDirs(from);
      for (const dir of expectedDirs) {
        if (specsStatus[dir] && !specsStatus[dir].populated) {
          specsWarnings.push(`specs/${dir}/ is empty (expected before Phase ${targetPhase})`);
        }
      }
    }

    // Evidence gate: some required criteria must leave a persisted artifact or a
    // witnessed test result — the boolean mark alone does not satisfy them. This
    // is what makes a stamped gate auditable after a failure instead of vanishing
    // in the chat. Quality stays a human judgment; existence and observation do not.
    const artifactMissing = this.missingEvidence(from);

    // 2→3: every module a finding cites must exist in the architecture table, in
    // SOME version. Caught with the session open, instead of the analysis finding
    // out later that findings point at modules no artifact records.
    const moduleDrift = from === 2 ? this.moduleTraceabilityErrors() : [];

    if (!validation.valid || artifactMissing.length > 0 || moduleDrift.length > 0) {
      return {
        ok: false,
        error: {
          message: `Cannot advance from Phase ${from} to Phase ${targetPhase}.`,
          missingCriteria: [...validation.missingCriteria, ...artifactMissing, ...moduleDrift],
          safeguardViolations: validation.safeguardViolations,
          specsWarnings,
        },
      };
    }

    // Valid transition
    this.state.history.push({
      from,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      criteriaMet: Array.from(exitCriteriaMet.entries())
        .filter(([, met]) => met)
        .map(([criterion]) => criterion),
    });

    this.state.currentPhase = targetPhase;
    this.state.currentIteration = 1;
    this.resetLoopCounter();

    // Re-entering Phase 2 from the 2↔3 loop is a FRESH critique of the new
    // architecture version V(N+1): lenses re-declared, findings re-produced for
    // the new design, criticals and concentration re-analysed. Reset EVERY Phase 2
    // exit criterion so the gate re-requires the full round — not just the lens
    // declaration — and the sidebar reflects a clean round. A critique of V(1)
    // carried forward as if it were of V(N+1) is the defect the pilots exposed.
    if (from === 3 && targetPhase === 2) {
      for (const ec of this.state.exitCriteria) {
        if (ec.phase === 2) ec.met = false;
      }
    }

    this.save();

    // Returns OK with specs warnings if any
    return { ok: true, value: undefined };
  }

  startIteration(phase: number): Result<IterationInfo, string> {
    if (!this.state) {
      return { ok: false, error: "Project not initialized." };
    }
    if (this.state.currentPhase !== phase) {
      return { ok: false, error: `Current phase is ${this.state.currentPhase}, not ${phase}.` };
    }

    this.state.currentIteration += 1;

    this.save();

    return {
      ok: true,
      value: {
        phase,
        iterationNumber: this.state.currentIteration,
      },
    };
  }

  // --- Recording ---

  recordDecision(phase: number, category: string, content: string): Decision {
    if (!this.state) throw new Error("Project not initialized.");

    const decision: Decision = {
      id: randomUUID(),
      phase,
      category,
      content,
      timestamp: new Date().toISOString(),
    };

    this.state.decisions.push(decision);
    this.save();

    // A named diagnosis clears the S6 counter: the failures are understood.
    if (DIAGNOSIS_CATEGORIES.includes(category.trim().toLowerCase())) {
      this.clearLoopCredit();
    }

    return decision;
  }

  /**
   * Appends to projectSpec, stamping each new entry with the phase and instant it
   * was recorded. Existing entries — including bare strings from older projects —
   * are left exactly as they are; a value already present is not re-stamped, so a
   * date always marks first appearance.
   */
  updateProjectSpec(spec: Partial<{ stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    if (!this.state.projectSpec) {
      this.state.projectSpec = { stack: [], outOfScope: [], patterns: [], constraints: [] };
    }
    const ps = this.state.projectSpec;
    const at = new Date().toISOString();
    const phase = this.state.currentPhase;

    const merge = (current: SpecItem[], incoming: string[] | undefined): SpecItem[] => {
      if (!incoming) return current;
      const seen = new Set(current.map(specValue));
      const out = [...current];
      for (const raw of incoming) {
        const value = raw.trim();
        if (value.length === 0 || seen.has(value)) continue;
        seen.add(value);
        out.push({ value, phase, at });
      }
      return out;
    };

    ps.stack = merge(ps.stack, spec.stack);
    ps.outOfScope = merge(ps.outOfScope, spec.outOfScope);
    ps.patterns = merge(ps.patterns, spec.patterns);
    ps.constraints = merge(ps.constraints, spec.constraints);
    this.save();
  }

  /** projectSpec as written — entries may be strings (older projects) or stamped objects. */
  getProjectSpec(): ProjectSpec {
    if (!this.state) throw new Error("Project not initialized.");
    return this.state.projectSpec ?? { stack: [], outOfScope: [], patterns: [], constraints: [] };
  }

  /** projectSpec flattened to plain strings, for callers that only want the values. */
  getProjectSpecValues(): { stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] } {
    const ps = this.getProjectSpec();
    return {
      stack: ps.stack.map(specValue),
      outOfScope: ps.outOfScope.map(specValue),
      patterns: ps.patterns.map(specValue),
      constraints: ps.constraints.map(specValue),
    };
  }

  updateScore(score: number, breakdown: ScoreBreakdown): void {
    if (!this.state) throw new Error("Project not initialized.");
    this.state.phase0Score = score;
    this.state.phase0Breakdown = breakdown;
    this.save();
  }

  markExitCriterion(phase: number, criterion: string, met: boolean, details?: string): void {
    if (!this.state) throw new Error("Project not initialized.");

    const existing = this.state.exitCriteria.find(
      (c) => c.phase === phase && c.criterion === criterion
    );

    if (existing) {
      existing.met = met;
      existing.details = details;
    } else {
      this.state.exitCriteria.push({ phase, criterion, met, details });
    }

    this.save();
  }

  markExitCriteria(entries: Array<{ phase: number; criterion: string; met: boolean; details?: string }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    for (const e of entries) {
      const existing = this.state.exitCriteria.find(
        (c) => c.phase === e.phase && c.criterion === e.criterion
      );
      if (existing) {
        existing.met = e.met;
        existing.details = e.details;
      } else {
        this.state.exitCriteria.push({ phase: e.phase, criterion: e.criterion, met: e.met, details: e.details });
      }
    }
    this.save();
  }

  // --- Safeguards ---

  checkSafeguard(id: string): SafeguardResult {
    if (!this.state) {
      return { id, status: "ok", details: "Project not initialized." };
    }
    const result = validateSafeguard(id, this.state);

    // Update internal safeguard state
    const sg = this.state.safeguards.find((s) => s.id === id);
    if (sg) {
      sg.status = result.status;
      sg.details = result.details;
      sg.lastChecked = new Date().toISOString();
      this.save();
    }

    return result;
  }

  checkAllSafeguards(): SafeguardResult[] {
    if (!this.state) return [];
    const results = getSafeguardsForPhase(this.state.currentPhase)
      .map((s) => validateSafeguard(s.id, this.state!));

    for (const result of results) {
      const sg = this.state.safeguards.find((s) => s.id === result.id);
      if (sg) {
        sg.status = result.status;
        sg.details = result.details;
        sg.lastChecked = new Date().toISOString();
      }
    }
    this.save();

    return results;
  }

  // --- Specs ---

  checkSpecsStatus(): SpecsStatus {
    const dirs = [
      "references", "domain", "technical", "examples",
      "design", "models", "datasets", "validation", "competitors",
    ];

    const status: SpecsStatus = {};
    for (const dir of dirs) {
      const dirPath = path.join(this.specsPath, dir);
      try {
        if (fs.existsSync(dirPath)) {
          const files = fs.readdirSync(dirPath).filter((f) => f !== "README.md");
          status[dir] = { populated: files.length > 0, fileCount: files.length };
        } else {
          status[dir] = { populated: false, fileCount: 0 };
        }
      } catch {
        status[dir] = { populated: false, fileCount: 0 };
      }
    }
    return status;
  }

  // --- Loop Counter (S6) ---

  /**
   * Records the outcome of a test run. Only FAILURES accumulate: a green run is
   * the end of the work, never a loop, so it clears the counter. Blocking is
   * decided by the caller reading getLoopCounter() BEFORE the run.
   */
  recordTestOutcome(command: string, failed: boolean): { count: number } {
    if (!this.state) return { count: 0 };

    // Record what the engine actually witnessed — this is what gates tests_passing
    // (S4), independent of the S6 loop-counter logic below.
    this.state.lastTestOutcome = {
      outcome: failed ? "fail" : "pass",
      phase: this.state.currentPhase,
      at: new Date().toISOString(),
    };

    if (!failed) {
      this.resetLoopCounter();  // resetLoopCounter saves, persisting lastTestOutcome too
      return { count: 0 };
    }

    const normalized = this.normalizeCommandPattern(command);
    const counter = this.state.loopCounter;
    const now = new Date().toISOString();

    if (counter && counter.pattern === normalized && counter.count > 0) {
      counter.count += 1;
      counter.lastSeen = now;
    } else {
      this.state.loopCounter = {
        pattern: normalized,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        lastDiagnosis: counter?.lastDiagnosis,
      };
    }

    this.save();
    return { count: this.state.loopCounter.count };
  }

  /**
   * A named diagnosis was recorded — the failures so far are understood, not
   * blind. Clears the counter and lets the next run through. This is the escape
   * hatch the S6 block message promises.
   */
  clearLoopCredit(): void {
    if (!this.state) return;
    const now = new Date().toISOString();
    this.state.loopCounter = {
      pattern: "",
      count: 0,
      firstSeen: "",
      lastSeen: "",
      lastDiagnosis: now,
    };
    this.save();
  }

  resetLoopCounter(): void {
    if (!this.state) return;
    this.state.loopCounter = {
      pattern: "",
      count: 0,
      firstSeen: "",
      lastSeen: "",
      lastDiagnosis: this.state.loopCounter?.lastDiagnosis,
    };
    this.save();
  }

  /** True when undiagnosed failures reached the threshold — next test run is blocked. */
  isLoopBlocked(): boolean {
    return this.getLoopCounter().count >= LOOP_FAILURE_THRESHOLD;
  }

  getLoopCounter(): { pattern: string; count: number; lastDiagnosis?: string } {
    if (!this.state || !this.state.loopCounter) return { pattern: "", count: 0 };
    const c = this.state.loopCounter;
    return { pattern: c.pattern, count: c.count, lastDiagnosis: c.lastDiagnosis };
  }

  /**
   * Normalizes a test command into a pattern. The suite/target argument is kept:
   * S6 talks about iterations on the same MODULE, so `npm test -- consent` and
   * `npm test -- link` must not collapse into the same pattern.
   */
  private normalizeCommandPattern(cmd: string): string {
    const trimmed = cmd.trim().toLowerCase();

    let runner = "";
    if (/\b(npm\s+test|npm\s+run\s+test|npx\s+jest|jest|vitest|mocha)\b/.test(trimmed)) runner = "test:js";
    else if (/\b(pytest|python\s+-m\s+pytest|unittest)\b/.test(trimmed)) runner = "test:py";
    else if (/\bcargo\s+test\b/.test(trimmed)) runner = "test:rust";
    else if (/\bgo\s+test\b/.test(trimmed)) runner = "test:go";
    else if (/\bnpm\s+run\s+build\b/.test(trimmed)) runner = "build";
    else if (/\btsc\b/.test(trimmed)) runner = "compile";
    else return trimmed.substring(0, 50);

    // Target = the suite/file/pattern being exercised, if any. Strips flags and
    // the runner words themselves; what remains identifies the module under test.
    const target = trimmed
      .replace(/^.*?\b(npm\s+run\s+test|npm\s+test|npx\s+jest|jest|vitest|mocha|pytest|python\s+-m\s+pytest|unittest|cargo\s+test|go\s+test|npm\s+run\s+build|tsc)\b/, "")
      .replace(/(^|\s)--?[\w-]+(=\S+)?/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return target ? `${runner}:${target}` : runner;
  }

  // --- Meta-iteration (v1.0 → v2.0) ---

  startNewCycle(): Result<{ cycle: number }, string> {
    if (!this.state) {
      return { ok: false, error: "Project not initialized." };
    }
    if (this.state.currentPhase !== 7) {
      return { ok: false, error: `Current phase is ${this.state.currentPhase}. New cycle can only start from Phase 7 (Post-Review).` };
    }

    // Check Phase 7 exit criteria
    const p7Criteria = this.state.exitCriteria.filter((c) => c.phase === 7);
    const unmet = p7Criteria.filter((c) => !c.met);
    if (unmet.length > 0) {
      return { ok: false, error: `Phase 7 exit criteria not met: ${unmet.map((c) => c.criterion).join(", ")}. Complete Post-Review before starting new cycle.` };
    }

    // Evidence gate (same as advancePhase): a stamped P7 criterion cannot open the
    // new cycle without its persisted artifact — e.g. lessons_documented must exist
    // as a file, so the record that feeds the next cycle survives the session.
    const missing = this.missingEvidence(7);
    if (missing.length > 0) {
      return { ok: false, error: missing.join(" ") };
    }

    // Count completed cycles from history (how many times we've reached phase 7)
    const cycleCount = this.state.history.filter((h) => h.to === 7).length + 1;

    // Record cycle boundary in history
    this.state.history.push({
      from: 7,
      to: 0,
      timestamp: new Date().toISOString(),
      criteriaMet: p7Criteria.map((c) => c.criterion),
    });

    // Preserve: decisions, projectSpec, history
    // Reset: phase, iteration, score, exit criteria, safeguards, loop counter
    this.state.currentPhase = 0;
    this.state.currentIteration = 1;
    this.state.phase0Score = null;
    this.state.phase0Breakdown = null;
    this.state.exitCriteria = [];
    this.state.safeguards = [
      { id: "S0", status: "ok" },
      { id: "S1", status: "ok" },
      { id: "S2", status: "ok" },
      { id: "S3", status: "ok" },
      { id: "S4", status: "ok" },
      { id: "S5", status: "ok" },
      { id: "S6", status: "ok" },
      { id: "S7", status: "ok" },
    ];
    this.resetLoopCounter();

    this.save();
    return { ok: true, value: { cycle: cycleCount + 1 } };
  }

  // --- Private helpers ---

  private getExpectedSpecsDirs(phase: number): string[] {
    switch (phase) {
      case 0: return ["references", "domain", "competitors"];
      case 1: return ["technical", "models", "examples"];
      case 5: return ["technical", "examples", "datasets"];
      case 6: return ["datasets", "validation"];
      default: return [];
    }
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
