// Versus core types

export interface PhaseState {
  agent?: "copilot" | "claude" | "qwen" | "kimi";  // identifies which extension owns this state
  projectName: string;
  projectDescription: string;
  projectSpec: ProjectSpec;      // structured technical context
  currentPhase: number;          // 0-7
  currentIteration: number;      // within the phase
  phase0Score: number | null;    // 0-100
  phase0Breakdown: ScoreBreakdown | null;
  decisions: Decision[];
  exitCriteria: ExitCriterionState[];
  safeguards: SafeguardState[];
  loopCounter: LoopCounter;
  /** Last test run the test-outcome hook actually witnessed. Gates tests_passing:
   *  the engine must have seen a green run in the phase, not just be told it passed. */
  lastTestOutcome?: { outcome: "pass" | "fail"; phase: number; at: string };
  /** Lens activation for Phase 2, recorded STRUCTURALLY by record_activated_lenses —
   *  ONE entry per critique iteration (the 2↔3 loop re-declares against each new
   *  architecture version). Was a free-text decision consumers had to grep for
   *  "ACTIVATED LENSES", which failed silently in any other language and could not be
   *  validated against the canonical lens set. Per-iteration history is what lets a
   *  finding be matched to the lens set in force when it was produced. */
  activatedLenses?: LensActivation[];
  /** State-schema era. Absent = a project created before v0.14.0: the legacy free-text
   *  lens decision is still honoured for it. Present = a project that must use the
   *  structured record — so the fallback cannot become an opt-out on new work. */
  stateVersion?: number;
  lastPhaseStateCheck?: string;  // ISO timestamp — gateway guard for smaller models
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  history: PhaseTransition[];    // transition log
}

/** Which lenses one critique iteration activated, and why the others were not.
 *  Names are validated against rules/lenses.ts on write, so a later analysis can
 *  group on this field across projects without a normalization table. */
export interface LensActivation {
  universal: string[];                                  // the 7, always
  conditional: string[];                                // the subset activated this iteration
  notActivated: { lens: string; reason: string }[];     // the rest, each with a reason
  iteration: number;                                    // critique iteration (1 = first Phase 2 pass)
  againstVersion: number;                               // architecture version it was decided against
  recordedAt: string;                                   // ISO timestamp
}

/**
 * A projectSpec entry. Either a plain string (legacy projects) or a timestamped
 * record capturing WHEN the entry was added and in which phase — so a later
 * analysis can ask "which entries existed when Phase 2 declared lenses in
 * iteration N?". Readers must accept both forms (use specEntryValue).
 */
export type SpecEntry = string | { value: string; phase?: number; at: string };

/** Extracts the string value of a SpecEntry regardless of form. */
export function specEntryValue(e: SpecEntry): string {
  return typeof e === "string" ? e : e.value;
}

/** Structured technical context — survives model switches */
export interface ProjectSpec {
  stack: SpecEntry[];            // approved technologies (e.g., "TypeScript", "Node 18+")
  outOfScope: SpecEntry[];       // explicitly excluded (e.g., "Local models")
  patterns: SpecEntry[];         // architectural patterns (e.g., "MCP server standalone")
  constraints: SpecEntry[];      // hard constraints (e.g., "Copilot-only, no Claude Code artifacts")
}

/**
 * S6 loop detection. `count` is consecutive test FAILURES with no diagnosis
 * recorded between them — not test executions. A passing run, a recorded
 * diagnosis, or a phase change all clear it. Debugging with a named cause per
 * round is the normal cycle; failing repeatedly without naming a cause is the
 * blind loop S6 exists to stop.
 */
export interface LoopCounter {
  pattern: string;             // normalized command pattern of the failing runs
  count: number;               // consecutive undiagnosed failures
  firstSeen: string;           // ISO timestamp
  lastSeen: string;
  lastDiagnosis?: string;      // ISO timestamp of the diagnosis that last cleared the counter
}

export interface ScoreBreakdown {
  clarezaProblema: number;       // weight 10
  casosDeUso: number;            // weight 15
  vocabulario: number;           // weight 10
  ambiguidades: number;          // weight 15
  foraDeEscopo: number;          // weight 10
  criteriosSucesso: number;      // weight 10
  premissas: number;             // weight 10
  documentacao: number;          // weight 5
  usuarioConfirmou: number;      // weight 10
  iaConfiante: number;           // weight 5
}

export interface Decision {
  id: string;
  phase: number;
  category: string;
  content: string;
  timestamp: string;
}

export interface ExitCriterionState {
  phase: number;
  criterion: string;
  met: boolean;
  details?: string;
}

export interface SafeguardState {
  id: string;                  // "S0" to "S7"
  status: "ok" | "warning" | "violated";
  details?: string;
  lastChecked?: string;
}

export interface SpecsStatus {
  [directory: string]: {
    populated: boolean;
    fileCount: number;
  };
}

export interface PhaseTransition {
  from: number;
  to: number;
  timestamp: string;
  criteriaMet: string[];
}

export interface TransitionError {
  message: string;
  missingCriteria: string[];
  safeguardViolations?: string[];  // a violated safeguard vetoes the transition — say which
  specsWarnings?: string[];
}

export interface IterationInfo {
  phase: number;
  iterationNumber: number;
  previousSummary?: string;
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function createDefaultState(name: string, description: string): PhaseState {
  return {
    agent: "kimi",
    projectName: name,
    projectDescription: description,
    projectSpec: { stack: [], outOfScope: [], patterns: [], constraints: [] },
    currentPhase: 0,
    currentIteration: 1,
    phase0Score: null,
    phase0Breakdown: null,
    decisions: [],
    activatedLenses: [],
    stateVersion: 1,
    exitCriteria: [],
    safeguards: [
      { id: "S0", status: "ok" },
      { id: "S1", status: "ok" },
      { id: "S2", status: "ok" },
      { id: "S3", status: "ok" },
      { id: "S4", status: "ok" },
      { id: "S5", status: "ok" },
      { id: "S6", status: "ok" },
      { id: "S7", status: "ok" },
    ],
    loopCounter: { pattern: "", count: 0, firstSeen: "", lastSeen: "" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
}
