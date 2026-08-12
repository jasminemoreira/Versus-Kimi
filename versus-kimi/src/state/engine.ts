// State Engine — manages persistent methodology state

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  PhaseState,
  Decision,
  ExitCriterionState,
  ScoreBreakdown,
  SpecsStatus,
  TransitionError,
  IterationInfo,
  Result,
  createDefaultState,
  SafeguardState,
  SpecEntry,
  specEntryValue,
  LensActivation,
  TestProvenance,
} from "./types";
import {
  isValidTransition,
  getExitCriteriaForPhase,
} from "../rules/phases";
import { CONDITIONAL_LENSES, UNIVERSAL_LENSES, canonicalLens } from "../rules/lenses";
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
        return this.state;
      }
    } catch (err) {
      // state.json corrupted — returns null
    }
    return null;
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

  /**
   * The current critique iteration: how many times the run has ENTERED Phase 2.
   * `currentIteration` cannot serve this — it resets to 1 on every phase change,
   * INCLUDING the 3→2 loop-back, so it does not track the critique round. Counting
   * transitions into Phase 2 (the initial 1→2 plus each 3→2 loop) does, and it is
   * the number the matrix's `## Iteração N` headers are meant to mirror. Minimum 1
   * so a declaration made before any transition (tests) still lands somewhere.
   */
  private critiqueIteration(): number {
    const entries = (this.state?.history ?? []).filter((h) => h.to === 2).length;
    return Math.max(1, entries);
  }

  /** Current architecture version = number of `## V(N)` sections in architecture.md,
   *  or 1 if none/absent. Stamped on a lens declaration as `againstVersion` so the
   *  analysis can see which design the critique ran against. */
  private currentArchitectureVersion(): number {
    try {
      const full = path.join(this.specsPath, "technical/architecture.md");
      if (!fs.existsSync(full)) return 1;
      const text = fs.readFileSync(full, "utf-8");
      const n = (text.match(/^#{1,6}\s*V\s*\(\s*\d+\s*\)/gmi) || []).length;
      return n > 0 ? n : 1;
    } catch { return 1; }
  }

  /** Finding rows of the coverage matrix, each tagged with the iteration of the
   *  `## Iteração N` section it sits under (null before the first header). The lens
   *  is the 3rd cell, severity the 4th — the row format is frozen
   *  (id | module | lens | severity | desc). */
  private matrixFindings(): { id: string; lens: string; severity: string; iteration: number | null }[] {
    const out: { id: string; lens: string; severity: string; iteration: number | null }[] = [];
    try {
      const full = path.join(this.specsPath, "design/coverage-matrix.md");
      if (!fs.existsSync(full)) return out;
      const text = fs.readFileSync(full, "utf-8");
      const idRe = /^(?!M-)[A-Za-z]{1,4}-\d+$/;                       // finding id, M- reserved for modules
      const headerRe = /^#{1,6}\s*(?:Itera[cç][ãa]o|Iteration)\s+(\d+)/i;
      let currentIter: number | null = null;
      for (const line of text.split(/\r?\n/)) {
        const h = line.match(headerRe);
        if (h) { currentIter = parseInt(h[1], 10); continue; }
        if (!line.includes("|")) continue;
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length && cells[0] === "") cells.shift();            // outer pipes
        if (cells.length && cells[cells.length - 1] === "") cells.pop();
        if (cells.length < 3) continue;
        if (!idRe.test(cells[0])) continue;
        out.push({ id: cells[0], lens: cells[2], severity: cells[3] ?? "", iteration: currentIter });
      }
    } catch { /* telemetry never blocks */ }
    return out;
  }

  /**
   * Errors in a finding row of the coverage matrix (2→3 gate). Three layers, all
   * form (never quality — whether a finding is real stays a human judgment):
   *   LENS 2.1 — every finding's lens must be one of the 19 canonical names, or the
   *         literal NENHUMA (the declared channel for a finding that fit no lens).
   *         `Sustainability` (a truncation) is rejected; the canonical name accepted.
   *   LENS 2.2 — a CONDITIONAL lens must have been DECLARED for that finding's
   *         iteration. Universals always run, so they never fail 2.2. Matched against
   *         the declaration WITH THE SAME iteration number — never the current one nor
   *         the union, the trap the v0.13.0 module gate proved costly: a lens set
   *         legitimately evolves across the loop (MEC entered in iteration 2 in the
   *         pilot). When the iteration cannot be resolved, the check degrades to the
   *         UNION of all declared sets — permissive, never over-blocking. Skips 2.2
   *         when nothing is declared yet.
   *   SEVERITY — the 4th cell must carry exactly one of 🔴 / 🟡 / 🟢. The analysis
   *         counts criticals vs important on this column; "high", "P1" or an empty
   *         cell would be miscounted. Tolerant of decoration ("🔴 Critical" passes),
   *         strict on the signal (zero or two severities blocks). All 853 findings in
   *         the pilot corpus already use exactly these three glyphs.
   */
  private findingRowErrors(): string[] {
    const findings = this.matrixFindings();
    if (findings.length === 0) return [];
    const acts = this.state?.activatedLenses ?? [];
    const union = new Set<string>();
    const byIter = new Map<number, Set<string>>();
    for (const a of acts) {
      for (const c of a.conditional) union.add(c);
      byIter.set(a.iteration, new Set(a.conditional));
    }
    const universals = new Set<string>(UNIVERSAL_LENSES as readonly string[]);
    const SEVERITIES = ["🔴", "🟡", "🟢"];
    const errs: string[] = [];
    for (const f of findings) {
      // Severity — exactly one canonical glyph, decoration tolerated.
      const sev = SEVERITIES.filter((s) => f.severity.includes(s));
      if (sev.length !== 1) {
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: severity "${f.severity || "(empty)"}" must be exactly one of ` +
          `🔴 (Critical) / 🟡 (Important) / 🟢 (Suggestion). The analysis counts criticals vs important on this ` +
          `column — a word, a code like "P1", or an empty cell cannot be counted.`
        );
      }
      // Lens 2.1 — canonical name or NENHUMA.
      if (/^nenhuma$/i.test(f.lens)) continue;                        // declared "no lens" channel
      const canon = canonicalLens(f.lens);
      if (!canon) {
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: lens "${f.lens}" is not one of the 19 canonical lens names (nor NENHUMA). ` +
          `Use the EXACT canonical name — an abbreviation or a translation breaks cross-project analysis, which groups on this column.`
        );
        continue;
      }
      if (universals.has(canon)) continue;                            // universals always valid
      if (acts.length === 0) continue;                                // nothing to check membership against yet
      // Lens 2.2 — declared for the finding's own iteration.
      const iterSet = f.iteration !== null ? byIter.get(f.iteration) : undefined;
      const declared = iterSet ?? union;                              // fall back to union, never the current-only set
      if (!declared.has(canon)) {
        const scope = iterSet ? `iteration ${f.iteration}` : "any declared iteration";
        errs.push(
          `[Phase 2] coverage_matrix row ${f.id}: lens "${canon}" was not among the conditional lenses declared for ${scope} ` +
          `(declared: ${[...declared].join(", ") || "none"}). A finding may only use a lens activated for its own iteration — ` +
          `declare it for that round with record_activated_lenses, or fix the finding's lens.`
        );
      }
    }
    return errs;
  }

  /**
   * Cross-gate (6→7): every CRITICAL (🔴) finding in the matrix must be traced to a
   * test or a stated reason in specs/validation/critical-coverage.md (III.1). Phase 3
   * resolves criticals; nothing re-checked the resolution survived the code — T26
   * reintroduced an O(n²) PRF-01/02 said to erase, T27 never implemented an approved
   * refinement, both found by luck. Form only: the id must be referenced; whether the
   * test truly covers it stays human. Skips when there are no criticals.
   */
  private criticalCoverageErrors(): string[] {
    const criticals = this.matrixFindings().filter((f) => f.severity.includes("🔴"));
    if (criticals.length === 0) return [];
    if (!this.artifactPresent("validation/critical-coverage.md")) {
      return [
        `[Phase 6] critical coverage: ${criticals.length} critical (🔴) finding(s) in the matrix, but ` +
        `specs/validation/critical-coverage.md is missing or empty. For each 🔴 id, name the test that ` +
        `covers it — or the reason there is none. Phase 3 resolved these; this confirms the code kept them resolved.`
      ];
    }
    const text = this.readSpec("validation/critical-coverage.md");
    const uncovered = criticals.filter((f) => !new RegExp(`\\b${escapeRegExp(f.id)}\\b`).test(text));
    if (uncovered.length > 0) {
      return [
        `[Phase 6] critical coverage: critical finding(s) ${uncovered.map((f) => f.id).join(", ")} ` +
        `are not referenced in specs/validation/critical-coverage.md. Each 🔴 finding must be traced to a ` +
        `test that would catch its regression, or a stated reason there is none (e.g. the module was removed).`
      ];
    }
    return [];
  }

  /**
   * Cross-gate (6→7): every NUMBERED premise of the architecture must be traced to a
   * test or a reason in specs/validation/premise-coverage.md (III.2). "A premise is
   * only protected when a test would fail if it stopped holding" — T29's streaming
   * premise (linear RSS spike) and T31's single-thread premise (SQLite across threads)
   * both passed Phase 2 plausibility and broke in the code. CONDITIONAL: premise ids
   * are not a stable convention in the corpus (half the projects don't number them),
   * so the gate engages only when architecture.md HAS numbered premises — never
   * over-blocking a project that writes them as prose. Guidance nudges numbering.
   */
  private premiseCoverageErrors(): string[] {
    const arch = this.readSpec("technical/architecture.md");
    if (!arch) return [];
    // Numbered premises: A-1, A-06, P-A8 — the forms seen in the corpus. NOT M-/finding ids.
    const ids = new Set<string>();
    const re = /\b((?:P-A|A)-?\d+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arch)) !== null) {
      const raw = m[1].toUpperCase().replace(/^A(\d)/, "A-$1");
      if (/^(P-A|A-)\d+$/.test(raw)) ids.add(raw);
    }
    if (ids.size === 0) return [];   // premises are prose here — do not over-block; guidance handles it
    if (!this.artifactPresent("validation/premise-coverage.md")) {
      return [
        `[Phase 6] premise coverage: the architecture numbers ${ids.size} premise(s) (${[...ids].slice(0, 6).join(", ")}${ids.size > 6 ? ", …" : ""}), ` +
        `but specs/validation/premise-coverage.md is missing or empty. For each numbered premise, name the test that ` +
        `would FAIL if it stopped holding — or the reason there is none. Criticising a premise's plausibility in Phase 2 ` +
        `is not the same as measuring whether it holds in the code.`
      ];
    }
    const text = this.readSpec("validation/premise-coverage.md");
    const uncovered = [...ids].filter((id) => !new RegExp(`\\b${escapeRegExp(id)}\\b`, "i").test(text));
    if (uncovered.length > 0) {
      return [
        `[Phase 6] premise coverage: premise(s) ${uncovered.join(", ")} are not referenced in ` +
        `specs/validation/premise-coverage.md. Each numbered premise needs a test that would measure it failing, ` +
        `or a stated reason there is none.`
      ];
    }
    return [];
  }

  /** Reads a specs/ file, or "" if absent/unreadable. */
  private readSpec(relPath: string): string {
    try {
      const full = path.join(this.specsPath, relPath);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : "";
    } catch { return ""; }
  }

  /**
   * Stamps engine-authored provenance onto the `verify:`-gated criteria of `phase`
   * (II.1/II.2), at the moment the transition passes. `nominal` is false when the gate
   * was met via a degraded path — a test pass not confirmed by a harness exit_code=0,
   * or a lens record satisfied by the legacy prose fallback — so a post-mortem sees the
   * bypass in the criterion itself, not only if the agent happened to log a decision.
   */
  private stampVerificationProvenance(phase: number): void {
    if (!this.state) return;
    for (const def of getExitCriteriaForPhase(phase)) {
      if (!def.verify) continue;
      const ec = this.state.exitCriteria.find((c) => c.phase === phase && c.criterion === def.criterion);
      if (!ec) continue;
      if (def.verify === "test-pass") {
        const t = this.state.lastTestOutcome;
        if (!t) continue;
        const nominal = t.source === "harness" && t.exitCode === 0;
        ec.verifiedBy = {
          path: "test-pass",
          nominal,
          at: new Date().toISOString(),
          note: nominal ? undefined : "pass NOT confirmed by a harness exit_code=0 — classified via output markers or a non-harness source",
          snapshot: { outcome: t.outcome, command: t.command, exitCode: t.exitCode, source: t.source, outputSha256: t.outputSha256, at: t.at },
        };
      } else if (def.verify === "lenses-recorded") {
        const cur = (this.state.activatedLenses ?? []).find((a) => a.iteration === this.critiqueIteration());
        const nominal = !!cur;
        ec.verifiedBy = {
          path: "lenses-recorded",
          nominal,
          at: new Date().toISOString(),
          note: nominal ? undefined : "satisfied via the legacy free-text fallback, not the structured record",
          snapshot: cur ? { iteration: cur.iteration, againstVersion: cur.againstVersion, recordedAt: cur.recordedAt } : {},
        };
      }
    }
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
   * Records Phase 2 lens activation as structured state, stamped with the current
   * critique iteration and architecture version. Rejects any name outside the
   * canonical 12 conditionals and any lens left unaccounted for: silence about a
   * lens is exactly what the criterion exists to prevent — "I did not activate it"
   * and "I forgot it" must not look the same. Re-recording within the SAME iteration
   * replaces that iteration's entry (a correction); a new iteration appends, so the
   * per-round history the matrix gate reads is preserved across the 2↔3 loop.
   */
  recordActivatedLenses(
    conditional: string[],
    notActivated: { lens: string; reason: string }[]
  ): Result<LensActivation, { message: string }> {
    if (!this.state) {
      return { ok: false, error: { message: "Project not initialized." } };
    }

    // Conditional-only. canonicalLens() spans all 19, so validating with it alone lets a
    // UNIVERSAL lens land in `conditional` — and the count of activated conditionals is a
    // measured variable of the study, not a display detail.
    const asConditional = (raw: string): string | null => {
      const c = canonicalLens(raw);
      return c && (CONDITIONAL_LENSES as readonly string[]).includes(c) ? c : null;
    };
    const outOfDomain = (raw: string): string =>
      canonicalLens(raw)
        ? `"${raw}" is a UNIVERSAL lens. Universals always run and are not passed here — this ` +
          `field records the CONDITIONAL set, and counting a universal among them corrupts it.`
        : `"${raw}" is not one of the 12 conditional lenses. Use the exact canonical name — ` +
          `abbreviations and translations break cross-project analysis, which groups on this value.`;

    const canon: string[] = [];
    for (const raw of conditional) {
      const c = asConditional(raw);
      if (!c) return { ok: false, error: { message: outOfDomain(raw) } };
      if (canon.includes(c)) {
        return { ok: false, error: { message:
          `Lens "${c}" is listed twice as activated. A duplicate inflates the activated count ` +
          `while passing the completeness check unnoticed.` } };
      }
      canon.push(c);
    }

    const no: { lens: string; reason: string }[] = [];
    for (const item of notActivated) {
      const c = asConditional(item.lens);
      if (!c) return { ok: false, error: { message: outOfDomain(item.lens) } };
      if (canon.includes(c)) {
        return { ok: false, error: { message:
          `Lens "${c}" appears as BOTH activated and not-activated. The record would contradict ` +
          `itself, and a later analysis has no way to tell which was meant.` } };
      }
      if (no.some((x) => x.lens === c)) {
        return { ok: false, error: { message: `Lens "${c}" is listed twice as not-activated.` } };
      }
      if (!item.reason || !item.reason.trim()) {
        return { ok: false, error: { message:
          `Lens "${c}" is marked not-activated without a reason. The justification is half the ` +
          `record: without it there is no way to tell a considered exclusion from an oversight.` } };
      }
      no.push({ lens: c, reason: item.reason.trim() });
    }

    const counted = new Set([...canon, ...no.map((n) => n.lens)]);
    const missing = CONDITIONAL_LENSES.filter((l) => !counted.has(l));
    if (missing.length > 0) {
      return { ok: false, error: { message:
        `${missing.length} conditional lens(es) unaccounted for: ${missing.join(", ")}. ` +
        `Every one of the 12 must be either activated or explicitly not activated with a reason.` } };
    }

    const iteration = this.critiqueIteration();
    const activation: LensActivation = {
      universal: [...UNIVERSAL_LENSES],
      conditional: canon,
      notActivated: no,
      iteration,
      againstVersion: this.currentArchitectureVersion(),
      recordedAt: new Date().toISOString(),
    };
    if (!this.state.activatedLenses) this.state.activatedLenses = [];
    const existing = this.state.activatedLenses.findIndex((a) => a.iteration === iteration);
    if (existing >= 0) this.state.activatedLenses[existing] = activation;   // correction within a round
    else this.state.activatedLenses.push(activation);
    this.save();
    return { ok: true, value: activation };
  }

  /** True if Phase 2 lens activation is on record for the CURRENT critique iteration.
   *  Checking the current iteration (not merely "any entry") is what forces a fresh
   *  declaration each round of the 2↔3 loop — a stale entry from iteration 1 must not
   *  satisfy the gate for iteration 2. Legacy free-text is honoured ONLY for projects
   *  created before this schema (no stateVersion); on new projects the structured
   *  record is mandatory, so the fallback cannot become an opt-out. */
  lensesRecorded(): boolean {
    const acts = this.state?.activatedLenses ?? [];
    if (acts.some((a) => a.iteration === this.critiqueIteration())) return true;
    if (this.state?.stateVersion !== undefined) return false;              // new project: structured only
    const marks = ["ACTIVATED LENSES", "LENTES ATIVADAS"];
    return (this.state?.decisions ?? []).some((d) =>
      marks.some((m) => d.content.toUpperCase().includes(m))
    );
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
        const t = this.state?.lastTestOutcome;
        // Distinguish "nothing was observed" from "observed and not a pass" — the old
        // message conflated them, and an agent whose suite was green had no signal that
        // the hook, not the tests, was the problem (I.3).
        const seen = t
          ? `The last run the engine recorded was outcome="${t.outcome}"` +
            `${t.command ? ` for \`${t.command}\`` : ""} at ${t.at}` +
            `${t.phase !== phase ? ` (in Phase ${t.phase}, not this phase)` : ""}` +
            `${typeof t.exitCode === "number" ? `, exit_code=${t.exitCode}` : ""}.` +
            (t.outcome === "unknown" ? ` "unknown" means the hook could not classify the output — check the run's output, or re-run.` : "")
          : `The engine has recorded NO test run in this phase.`;
        out.push(
          `[Phase ${phase}] ${def.criterion}: no witnessed passing test run in this phase. ${seen} ` +
          `A green run must be seen by the test-outcome hook (S4: never assume tests passed — execute and verify). ` +
          `If the suite is green but this stays red, the run was not classified as a pass — inspect get_phase_state.lastTestOutcome. ` +
          `Marking the criterion met is not enough.`
        );
      }
      if (def.verify === "lenses-recorded" && !this.lensesRecorded()) {
        out.push(
          `[Phase ${phase}] ${def.criterion}: lens activation is not on record for iteration ${this.critiqueIteration()}. ` +
          `Call record_activated_lenses(conditional, notActivated) — the structured tool — BEFORE advancing. ` +
          `Marking the criterion met is not enough: without the record, which lenses were applied cannot be reconstructed after the session, ` +
          `and each round of the 2↔3 loop must re-declare against the new architecture.`
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

    // Module-name traceability (2→3): every module a finding cites must exist in
    // the architecture's module table. Checked against the UNION of all versions
    // in architecture.md — a module removed between V(N) and V(N+1) is tolerated
    // (findings from its iteration are legitimate), but a name that appears in NO
    // version is drift, and it breaks the matrix's per-module traceability silently.
    const moduleDrift = from === 2 ? this.moduleTraceabilityErrors() : [];

    // Finding-row form (2→3): each finding's lens must be canonical (or NENHUMA) and
    // declared for its OWN iteration, and its severity must be one of 🔴/🟡/🟢. Lens
    // matched per-iteration, degrading to the union — never the current-only set (the
    // v0.13.0 over-block trap). Form only; whether a finding is real stays human.
    const rowDrift = from === 2 ? this.findingRowErrors() : [];

    // Phase 6 re-verifies what earlier phases decided survived the code (III.1/III.2):
    // every critical finding, and every numbered premise, traced to a test or a reason.
    const coverageDrift = from === 6
      ? [...this.criticalCoverageErrors(), ...this.premiseCoverageErrors()]
      : [];

    if (!validation.valid || artifactMissing.length > 0 || moduleDrift.length > 0 || rowDrift.length > 0 || coverageDrift.length > 0) {
      return {
        ok: false,
        error: {
          message: `Cannot advance from Phase ${from} to Phase ${targetPhase}.`,
          missingCriteria: [...validation.missingCriteria, ...artifactMissing, ...moduleDrift, ...rowDrift, ...coverageDrift],
          safeguardViolations: validation.safeguardViolations,
          specsWarnings,
        },
      };
    }

    // Gates passed — stamp engine-authored provenance on the verify-criteria we just
    // checked, before the transition commits (II.1/II.2).
    this.stampVerificationProvenance(from);

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

    // Backward transition inside the 2↔3 loop (only 3→2 today): every phase from
    // the target up to the one being left will be REDONE against the new design,
    // so reset all their exit criteria — Phase 2 AND Phase 3. A stamp from the
    // previous pass answered the OLD critique; it must not satisfy the gate for the
    // new one. v0.12.8 reset only Phase 2, leaving Phase 3's criticals_addressed,
    // important_decided, scope_preserved, architecture_simplified from iteration 1
    // to pass the 3→4 gate — the same "old answer counts as new" defect, one phase
    // over: nobody confirms the iteration-N criticals were addressed.
    if (targetPhase < from) {
      for (const ec of this.state.exitCriteria) {
        if (ec.phase >= targetPhase && ec.phase <= from) ec.met = false;
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

  updateProjectSpec(spec: Partial<{ stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] }>): void {
    if (!this.state) throw new Error("Project not initialized.");
    if (!this.state.projectSpec) {
      this.state.projectSpec = { stack: [], outOfScope: [], patterns: [], constraints: [] };
    }
    const ps = this.state.projectSpec;
    const at = new Date().toISOString();
    const phase = this.state.currentPhase;
    // New entries are timestamped; existing ones (string or object) are kept as-is.
    // Dedup is by VALUE, so a string and its timestamped form don't both survive.
    const merge = (existing: SpecEntry[], added: string[]): SpecEntry[] => {
      const have = new Set(existing.map(specEntryValue));
      const out = [...existing];
      for (const v of added) {
        if (!have.has(v)) { out.push({ value: v, phase, at }); have.add(v); }
      }
      return out;
    };
    if (spec.stack) ps.stack = merge(ps.stack, spec.stack);
    if (spec.outOfScope) ps.outOfScope = merge(ps.outOfScope, spec.outOfScope);
    if (spec.patterns) ps.patterns = merge(ps.patterns, spec.patterns);
    if (spec.constraints) ps.constraints = merge(ps.constraints, spec.constraints);
    this.save();
  }

  getProjectSpec(): { stack: string[]; outOfScope: string[]; patterns: string[]; constraints: string[] } {
    if (!this.state) throw new Error("Project not initialized.");
    const ps = this.state.projectSpec ?? { stack: [], outOfScope: [], patterns: [], constraints: [] };
    // Normalize to plain strings for consumers — the timestamps live in state.json
    // for the analysis to read directly; the tool response shape is unchanged.
    return {
      stack: ps.stack.map(specEntryValue),
      outOfScope: ps.outOfScope.map(specEntryValue),
      patterns: ps.patterns.map(specEntryValue),
      constraints: ps.constraints.map(specEntryValue),
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
   * the end of the work, never a loop, so it clears the counter. An `unknown` run
   * (unclassifiable output) is RECORDED — so it cannot leave a stale `fail` frozen
   * in place (I.1) — but it is not a failure: it neither satisfies the gate nor
   * counts toward S6. Blocking is decided by the caller reading getLoopCounter()
   * BEFORE the run. `provenance` (I.5) is stored verbatim when supplied.
   */
  recordTestOutcome(
    command: string,
    outcome: "pass" | "fail" | "unknown",
    provenance?: TestProvenance
  ): { count: number } {
    if (!this.state) return { count: 0 };

    // Record what the engine actually witnessed — this is what gates tests_passing
    // (S4), independent of the S6 loop-counter logic below.
    this.state.lastTestOutcome = {
      outcome,
      phase: this.state.currentPhase,
      at: new Date().toISOString(),
      command,
      ...(provenance ?? {}),
    };

    if (outcome === "pass") {
      this.resetLoopCounter();  // resetLoopCounter saves, persisting lastTestOutcome too
      return { count: 0 };
    }

    if (outcome === "unknown") {
      // Unclassifiable output is not a failure: leave the loop counter untouched,
      // just persist the record so the stale-fail freeze cannot happen.
      this.save();
      return { count: this.state.loopCounter?.count ?? 0 };
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
