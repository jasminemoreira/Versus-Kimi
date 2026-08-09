// The 19 lenses, as data — the single source of truth.
//
// They used to exist as prose inside the Phase 2 guidance table, so nothing could
// validate a lens name (a session could write "Segurança", "SEG" or "Security" and
// each passed), AND the names lived in two copies — here and in the guidance — kept
// in sync by hand. This file now holds the full definition of each lens (central
// question, exclusive failure class, and, for conditionals, the activation trigger);
// the guidance table is RENDERED from these defs, so the name a gate checks and the
// name the model reads can no longer drift. Instruction was never enforcement — these
// constants are, for both the record_activated_lenses enum and the matrix lens gate.

export interface LensDef {
  /** Canonical name — the value the gates and the enum compare against. */
  name: string;
  /** The generative question the lens applies to each module. */
  question: string;
  /** The failure class this lens exists to catch (its exclusive contribution). */
  failureClass: string;
  /** Project signal that activates a CONDITIONAL lens. Absent for universals,
   *  which always apply. */
  trigger?: string;
}

export const UNIVERSAL_LENS_DEFS: LensDef[] = [
  { name: "Assumptions", question: "What does this design assume as true without declaring?", failureClass: "Failures from hidden assumptions" },
  { name: "Architectural", question: "Can each module be replaced, removed, or tested in isolation?", failureClass: "Hidden coupling, circular dependencies, SRP violation" },
  { name: "Implementability", question: "Can I code this module in a single session with available context?", failureClass: "Incomplete specs, insufficient granularity" },
  { name: "Scientific", question: "Does each value/formula/algorithm have a verifiable bibliographic reference?", failureClass: "Invented parameters, plausibility-based logic" },
  { name: "Security", question: "How would an attacker exploit this with minimal effort?", failureClass: "Unanalyzed attack surface" },
  { name: "Performance", question: "Where are the bottlenecks? Asymptotic behavior?", failureClass: "Hidden bottlenecks, degradation at scale" },
  { name: "Regulatory", question: "Does each normative requirement have traceability to a module?", failureClass: "Non-compliance with applicable standards" },
];

export const CONDITIONAL_LENS_DEFS: LensDef[] = [
  { name: "Resilience", question: "What happens when an external dependency fails, responds slowly, or returns unexpected data?", failureClass: "Cascading failures, retry storms, partial outages", trigger: "External dependencies (APIs, DBs, queues, third-party services)" },
  { name: "UI/UX", question: "Can the user complete their task without frustration, confusion, or error?", failureClass: "Confusing flows, dead-end states, missing feedback, accessibility failures", trigger: "Any surface a PERSON operates — including a CLI or operational tooling, not only graphical end-user interfaces" },
  { name: "Migration / Coexistence", question: "What breaks during the transition from old to new? Is there a rollback path?", failureClass: "Data loss in migration, functional regression vs. legacy, impossible rollback", trigger: "Replacing or modifying existing production system" },
  { name: "Sustainability / Proportionality", question: "Is resource consumption proportionate to value delivered? Cost at 10× scale?", failureClass: "GPU where CPU suffices, heavy model for simple task, infinite data retention", trigger: "The system decides, allocates, or consumes a resource whose cost grows with use — e.g. (but NOT only) AI/ML, high-volume data processing, elastic infrastructure. Apply the central question, do not just match the examples" },
  { name: "Ethical / Human Impact", question: "Who is potentially harmed? Are there audit, correction, and transparency mechanisms?", failureClass: "Algorithmic bias, digital exclusion, automated decisions without human recourse", trigger: "Automated decisions about people (scoring, classification, moderation)" },
  { name: "Process / Workflow", question: "Are processes, state transitions, actor responsibilities, and exception paths complete?", failureClass: "Orphaned states, ambiguous handoffs, missing actors, happy-path bias", trigger: "Multi-actor flows, state machines, or business processes" },
  { name: "Governance / Accountability", question: "Is every action attributable? Does every data entity have a defined owner?", failureClass: "No data ownership, no accountability, shadow data flows", trigger: "The system records or decides something someone will later need to audit, attribute, or answer for — data with distinct owners, actions that need authorship, or an obligation to account. This is a SYSTEM property: a single-operator project activates it when the system has it (not only multi-team / compliance contexts)" },
  { name: "Observability / Operability", question: "Can degradation be detected and incidents diagnosed in production without code changes?", failureClass: "Opaque systems where nobody can figure out why it failed", trigger: "Production systems with operational requirements" },
  { name: "Control Engineering", question: "Where does the system generate an error signal and correct it? Risk of oscillation or state drift?", failureClass: "Systems that react to events but don't regulate state — oscillation, drift, runaway feedback", trigger: "State synchronization, runtime configuration affecting behavior, self-correcting or feedback-driven systems" },
  { name: "Game Theory", question: "Do system actors have aligned incentives? Where does the design assume cooperation and may encounter strategic defection?", failureClass: "Architectures that work under cooperation assumptions but collapse under adversarial or strategic behavior", trigger: "Multiple independent actors, public API, external integrations, marketplace or platform design" },
  { name: "Linguistics / Grammar", question: "Is the interface contract unambiguous? Can two correct implementations of the same contract produce incompatible behaviors?", failureClass: "Protocol ambiguity — two correct implementations that are mutually incompatible", trigger: "Inter-component communication, protocol definitions, message formats, interface contracts between independent teams" },
  { name: "Mechanical Engineering", question: "Where are the tolerances? Does the system tolerate variation or only work at exact specification?", failureClass: "Rigid coupling disguised as tolerance — failure from small deviations in dependency versions, environment, or load", trigger: "Module maintenance, system evolution, long-lived systems with technical debt accumulation" },
];

// Name arrays are DERIVED from the defs above — one source, no hand-kept second copy.
// These remain plain string[] because the enum, the gates and the tests all consume
// them as names; the rich metadata rides alongside in the *_DEFS.
export const UNIVERSAL_LENSES: string[] = UNIVERSAL_LENS_DEFS.map((l) => l.name);
export const CONDITIONAL_LENSES: string[] = CONDITIONAL_LENS_DEFS.map((l) => l.name);
export const ALL_LENSES: readonly string[] = [...UNIVERSAL_LENSES, ...CONDITIONAL_LENSES];

/** Canonical name for `raw`, or null if it is not one of the 19.
 *  Tolerates case and spacing around "/" — "UI / UX" is the same lens as "UI/UX" —
 *  but NOT translations or abbreviations, which are what break cross-project
 *  aggregation. */
export function canonicalLens(raw: string): string | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
  const target = norm(raw);
  return ALL_LENSES.find((l) => norm(l) === target) ?? null;
}
