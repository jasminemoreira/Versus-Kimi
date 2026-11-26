// MCP Tools: state queries

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { validateSafeguard } from "../../rules/safeguards";
import { specEntryValue, PhaseState } from "../../state/types";

export const getPhaseStateTool: Tool = {
  name: "get_phase_state",
  description:
    "MUST be called at the start of each interaction. Returns the current phase, iteration, score, " +
    "decisions, and safeguards of the Iterative Convergence methodology. " +
    "Without calling this tool, you don't know which phase you're in or what to do.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const getDecisionsTool: Tool = {
  name: "get_decisions",
  description:
    "Queries decisions made in any phase of the methodology. " +
    "Use to retrieve previous decisions before making new ones.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7). If omitted, returns all decisions.",
      },
    },
    required: [],
  },
};

export const getExitCriteriaTool: Tool = {
  name: "get_exit_criteria",
  description:
    "Returns the exit criteria of a phase with status (met/pending). " +
    "Use to find out what's missing before attempting to advance phase.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7).",
      },
    },
    required: ["phase"],
  },
};

// --- Transport budgets ---------------------------------------------------
// 0.11.0 budgeted this against a ~5,700-char paging limit. That limit was measured
// on the VS Code chat host (the LocalQwen build), not on Kimi: Kimi Code inlines a
// tool result up to 50,000 chars (agent-core-v2 toolContract,
// DEFAULT_TOOL_RESULT_MAX_CHARS) and spills above it; Kimi transcripts show
// get_phase_guidance at 17,113 chars arriving inline. The budgets stay anyway: the
// snapshot is the gateway guard, a lean one costs nothing, and the raw fields measured
// 50.9 KB on a real project — past even the real limit.
const SPEC_PER_LIST = 6;
const DECISION_MAXLEN = 200;
const DECISION_BUDGET = 2200;
/** Final ceiling for the whole result. The per-field budgets bound COUNTS, not
 *  characters, so a project with six very long constraints still measured 5,623.
 *  Far under Kimi's 50,000 limit, so this is a size choice, not a paging fix: the
 *  snapshot stays a snapshot whatever the field shapes. */
const RESULT_BUDGET = 5200;

/** Newest N per list, INDEPENDENTLY: a 200-entry stack must not evict constraints.
 *  Entries are normalized to plain strings — the {value, phase, at} stamp is analysis
 *  metadata the model never reads. Entries are never truncated: each is a distinct
 *  commitment, and half a constraint is worse than a counted omission. The per-message
 *  context also lists the spec (each list shortened past 600 chars). */
function budgetSpec(spec: PhaseState["projectSpec"]): { spec: Record<string, string[]>; omitted: number } {
  const out: Record<string, string[]> = { stack: [], outOfScope: [], patterns: [], constraints: [] };
  let omitted = 0;
  for (const k of ["stack", "outOfScope", "patterns", "constraints"] as const) {
    const v = ((spec?.[k] ?? []) as unknown[]).map((e) => specEntryValue(e as never));
    if (v.length > SPEC_PER_LIST) {
      omitted += v.length - SPEC_PER_LIST;
      out[k] = v.slice(-SPEC_PER_LIST);
    } else {
      out[k] = v;
    }
  }
  return { spec: out, omitted };
}

/** Newest first, SHORTENING content before dropping a decision whole — a long
 *  decision should still be visible as an entry, not vanish. */
function budgetDecisions(decisions: PhaseState["decisions"]): {
  shown: Array<{ phase: number; category: string; content: string }>;
  trimmed: boolean;
} {
  const shown: Array<{ phase: number; category: string; content: string }> = [];
  let used = 0;
  let trimmed = false;
  for (let i = decisions.length - 1; i >= 0; i--) {
    const d = decisions[i];
    const content =
      d.content.length > DECISION_MAXLEN ? d.content.slice(0, DECISION_MAXLEN).trimEnd() + "…" : d.content;
    if (content !== d.content) trimmed = true;
    const e = { phase: d.phase, category: d.category, content };
    const cost = JSON.stringify(e).length;
    if (used + cost > DECISION_BUDGET && shown.length > 0) break;
    shown.push(e);
    used += cost;
  }
  shown.reverse();
  return { shown, trimmed };
}

export function handleGetPhaseState(engine: StateEngine): string {
  const state = engine.getPhaseState();
  if (!state) {
    return JSON.stringify({
      error: "Project not initialized. Call init_project first.",
    });
  }
  // Mark that the model loaded context (gateway guard)
  engine.touchPhaseStateCheck();

  // Budgeted so the gateway guard never pages to disk (see Transport budgets).
  const { shown: recentDecisions, trimmed } = budgetDecisions(state.decisions);
  const { spec: budgetedSpec, omitted: specOmitted } = budgetSpec(state.projectSpec);

  // Detect Phase 7 completion → hint to offer new cycle
  let phase7Hint: string | undefined;
  if (state.currentPhase === 7) {
    const p7Criteria = state.exitCriteria.filter((c) => c.phase === 7);
    const allMet = p7Criteria.length > 0 && p7Criteria.every((c) => c.met);
    if (allMet) {
      phase7Hint = "ACTION REQUIRED: Phase 7 exit criteria are ALL met. You MUST offer the user a new development cycle in chat (R2 format): Option 1 'Start next cycle' (calls start_new_cycle()) / Option 2 'Project complete'. Do NOT skip this step.";
    }
  }

  // Detect "ready to advance" state for any phase < 7 — all criteria met but phase not advanced
  let readyToAdvanceHint: string | undefined;
  if (state.currentPhase < 7) {
    const phaseCriteria = engine.getExitCriteriaWithDefs(state.currentPhase);
    const allMet = phaseCriteria.length > 0 && phaseCriteria.every((c) => c.met);
    if (allMet) {
      readyToAdvanceHint = `⚠️ READY TO ADVANCE — Phase ${state.currentPhase} exit criteria are ALL met but currentPhase is still ${state.currentPhase}. Your VERY NEXT tool call MUST be advance_phase(target_phase=${state.currentPhase + 1}) followed by get_phase_guidance(). Do NOT write summary text. Do NOT wait for user input. Continue work into Phase ${state.currentPhase + 1} in the same turn.`;
    }
  }

  const result: Record<string, any> = {
    projectName: state.projectName,
    projectDescription: state.projectDescription,
    projectSpec: budgetedSpec,
    currentPhase: state.currentPhase,
    currentIteration: state.currentIteration,
    currentCycle: engine.currentCycle(),
    archivedCycles: (state.cycles ?? []).map((c) => c.cycle),
    phase0Score: state.phase0Score,
    decisionsCount: state.decisions.length,
    recentDecisions,
    // Live, like the sidebar: the cached status field is only rewritten by
    // check_all_safeguards, so reading it reports "ok" for a safeguard that is
    // actively blocking.
    safeguards: state.safeguards.map((s) => ({ id: s.id, status: validateSafeguard(s.id, state).status })),
    // What the test-outcome hook last witnessed (I.2). Without this a stuck
    // tests_passing gate was undiagnosable through the MCP interface — the agent had
    // to read .versus/state.json directly, bypassing the interface the methodology offers.
    lastTestOutcome: state.lastTestOutcome
      ? {
          ...state.lastTestOutcome,
          // A heredoc in the command was 2 KB on its own.
          command:
            state.lastTestOutcome.command && state.lastTestOutcome.command.length > DECISION_MAXLEN
              ? state.lastTestOutcome.command.slice(0, DECISION_MAXLEN).trimEnd() + "…"
              : state.lastTestOutcome.command,
        }
      : null,
    updatedAt: state.updatedAt,
  };

  if (phase7Hint) {
    result._phase7Action = phase7Hint;
  }
  if (readyToAdvanceHint) {
    result._nextAction = readyToAdvanceHint;
  }

  // Notes are rewritten on every pass because the counts they report change as
  // entries are dropped. The hints are never dropped: an instruction the model
  // must act on outranks the context it acts with.
  let dropped = specOmitted;
  const writeNotes = () => {
    if (dropped > 0) {
      result._specNote =
        `projectSpec shows the newest per list; ${dropped} older entrie(s) omitted here. ` +
        `The per-message context also lists the spec (each list shortened past 600 chars).`;
    }
    if (state.decisions.length > recentDecisions.length || trimmed) {
      result._decisionsNote =
        `recentDecisions: newest ${recentDecisions.length} of ${state.decisions.length}` +
        (trimmed ? `, long entries shortened to ${DECISION_MAXLEN} chars` : "") +
        `. Call get_decisions(phase?) for the rest.`;
    }
  };
  writeNotes();

  // Drop oldest-first until the whole result fits: decisions before spec entries,
  // since get_decisions can retrieve a decision but not a spec entry. Bounded by
  // construction — every pass removes an entry.
  while (JSON.stringify(result).length > RESULT_BUDGET) {
    if (recentDecisions.length > 1) {
      recentDecisions.shift();
    } else {
      const lists = ["stack", "outOfScope", "patterns", "constraints"] as const;
      const biggest = lists
        .filter((k) => budgetedSpec[k].length > 0)
        .sort((a, b) => JSON.stringify(budgetedSpec[b]).length - JSON.stringify(budgetedSpec[a]).length)[0];
      if (!biggest) break; // nothing left to give
      budgetedSpec[biggest].shift();
      dropped++;
    }
    writeNotes();
  }

  return JSON.stringify(result);
}

/** get_phase_state points here for the decisions it could not fit, so this must not
 *  be a bigger leak: a whole dump measured 601 KB on a real project — 12x Kimi's
 *  50,000-char inline limit. Newest first, within a budget. */
const DECISIONS_BUDGET = 5000;

export function handleGetDecisions(engine: StateEngine, args: { phase?: number }): string {
  const all = engine.getDecisions(args.phase);
  const shown: typeof all = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    let d = all[i];
    let cost = JSON.stringify(d).length;
    // One decision alone larger than the budget: truncate it rather than spill.
    if (shown.length === 0 && cost > DECISIONS_BUDGET) {
      const keep = Math.max(0, DECISIONS_BUDGET - (cost - d.content.length));
      d = {
        ...d,
        content:
          d.content.slice(0, keep).trimEnd() +
          `… [truncated; ${d.content.length} chars — narrow by phase]`,
      };
      cost = JSON.stringify(d).length;
    }
    if (used + cost > DECISIONS_BUDGET && shown.length > 0) break;
    shown.push(d);
    used += cost;
  }
  shown.reverse();
  const result: Record<string, unknown> = { count: all.length, shown: shown.length, decisions: shown };
  if (shown.length < all.length) {
    result._note = `newest ${shown.length} of ${all.length}; narrow by phase for the rest`;
  }
  return JSON.stringify(result);
}

export function handleGetExitCriteria(engine: StateEngine, args: { phase: number }): string {
  const criteria = engine.getExitCriteriaWithDefs(args.phase);
  const met = criteria.filter((c) => c.met).length;
  const total = criteria.length;
  return JSON.stringify({ phase: args.phase, met, total, criteria });
}

export const updateProjectSpecTool: Tool = {
  name: "update_project_spec",
  description:
    "Updates the project's structured technical context (stack, out-of-scope, patterns, constraints). " +
    "Use to register technical decisions in a structured way. " +
    "Items are added (merged), never overwritten. Duplicates are ignored.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stack: {
        type: "array",
        items: { type: "string" },
        description: "Approved technologies for the project (e.g., ['TypeScript', 'Node 18+', 'MCP SDK']).",
      },
      outOfScope: {
        type: "array",
        items: { type: "string" },
        description: "Items explicitly excluded from scope (e.g., ['Local models', 'Web UI']).",
      },
      patterns: {
        type: "array",
        items: { type: "string" },
        description: "Architectural patterns to follow (e.g., ['MCP server standalone', 'shared state.json']).",
      },
      constraints: {
        type: "array",
        items: { type: "string" },
        description: "Hard constraints of the project (e.g., ['Copilot-only', 'No external dependencies']).",
      },
    },
    required: [],
  },
};

export function handleUpdateProjectSpec(
  engine: StateEngine,
  args: { stack?: string[]; outOfScope?: string[]; patterns?: string[]; constraints?: string[] }
): string {
  const before = engine.getProjectSpec();
  engine.updateProjectSpec(args);
  const after = engine.getProjectSpec();
  // 0.18.0: return what CHANGED plus counts, not the whole spec. The spec only grows, and
  // the delivery audit measured a 40,764-char result on QuantumCalc (MCP results persist to
  // disk past 50,000). The caller already knows what it sent.
  const keys = ["stack", "outOfScope", "patterns", "constraints"] as const;
  const added: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  for (const k of keys) {
    const had = new Set(before[k]);
    const n = after[k].filter((v) => !had.has(v));
    if (n.length) added[k] = n;
    counts[k] = after[k].length;
  }
  return JSON.stringify({
    success: true,
    added,
    counts,
    message:
      "Project spec updated. Values already present were kept, not duplicated. get_phase_state shows the newest " +
      "entries per list, and the per-message context lists the spec.",
  });
}
