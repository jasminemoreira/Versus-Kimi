// The per-message STATE block, built for inject-context (UserPromptSubmit). It lives in
// its own module with no main(): in an esbuild bundle, `require.main === module` is true
// for EVERY module inlined into the entry, so a hook that imported another hook module
// would also run that hook's main(). Keep shared code in modules like this one.

import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { getPhaseDefinition } from "../rules/phases";
import { specEntryValue, Decision } from "../state/types";
import { VERSUS_VERSION } from "../version";

/** Budget for the whole injection. Kimi does NOT cap UserPromptSubmit output (agent-core-v2
 *  userPrompt.ts appends the stdout whole as a <hook_result> part; transcripts show 55–70K
 *  arriving intact). The cost is elsewhere: each injection is appended to the context and
 *  stays there, so a 70K injection on every message is 70K × messages. 9,000 keeps the
 *  per-message cost small and matches the other builds; it is a choice, not a host limit. */
export const INJECT_BUDGET = 9_000;
const DECISION_SNIPPET = 280;

export function buildInjection(engine: StateEngine, budget: number = INJECT_BUDGET, notices: string[] = []): string | null {
  const state = engine.getPhaseState();
  if (!state) return null;

  const phase = state.currentPhase;
  const phaseName = getPhaseDefinition(phase)?.name ?? "Unknown";
  const cycle = engine.currentCycle();

  // --- Must-see lines, in priority order (never budget-trimmed) ---
  const head: string[] = [
    // The running build's version (0.18.2): visible to the model and recorded in the transcript,
    // so "which Versus served this session" is a fact, not an inference from file dates.
    `[Versus] Phase ${phase} — ${phaseName} | Iteration ${state.currentIteration} | Cycle ${cycle} | v${VERSUS_VERSION}`,
  ];

  const upd = engine.noteVersion();
  if (upd) {
    head.push(
      `⚠ VERSUS UPDATED — this project was last opened by ${upd.from ? `Versus ${upd.from}` : "a Versus older than 0.18.0"}; ` +
      `now ${upd.to}. TELL THE USER, once, in your next reply.` +
      (upd.pending.length
        ? ` Required from here on and missing in this project: ${upd.pending.slice(0, 6).map((p) => `(${p})`).join(" ")}` +
          (upd.pending.length > 6 ? ` … +${upd.pending.length - 6} more (see state.json migrations).` : "")
        : " Nothing the new version requires is missing.")
    );
  }

  if (phase < 7) {
    const phaseCriteria = engine.getExitCriteriaWithDefs(phase);
    if (phaseCriteria.length > 0 && phaseCriteria.every((c) => c.met)) {
      head.push(
        `⚠️ READY TO ADVANCE — Phase ${phase} exit criteria are ALL met. Your VERY NEXT tool call MUST be ` +
        `advance_phase(target_phase=${phase + 1}) followed by get_phase_guidance(). Do NOT write summary text. ` +
        `Do NOT wait for user input. Continue work into Phase ${phase + 1} in the same turn.`
      );
    }
  }

  if (phase < 5) {
    head.push("RESTRICTION: Phases 0-4 — DO NOT implement code. Use the MCP tools to manage the methodology.");
  }

  const loop = engine.getLoopCounter();
  if (loop.count >= LOOP_FAILURE_THRESHOLD - 1) {
    const blocked = loop.count >= LOOP_FAILURE_THRESHOLD;
    head.push(
      `⚠ S6: "${loop.pattern}" failed ${loop.count}x in a row with no diagnosis recorded ` +
      `(threshold: ${LOOP_FAILURE_THRESHOLD}).` +
      (blocked
        ? ` Test runs are BLOCKED. Name the cause: record_decision(category='diagnosis', content='...') — that clears it.`
        : ` Record the root cause with record_decision(category='diagnosis') before the next run.`)
    );
  }

  // P2: warn when THIS critique round has no structured lens record yet. Counted per
  // iteration — the 2↔3 loop re-declares against each new version.
  if (phase === 2) {
    const round = Math.max(1, (state.history ?? []).filter((h) => h.to === 2).length);
    const declared = (state.activatedLenses ?? []).some((l) => l.iteration === round);
    if (!declared) {
      head.push(
        `⚠ P2 STEP 1 MISSING: iteration ${round} has no lens activation on record. Call ` +
        "record_activated_lenses(conditional=[...], notActivated=[{lens, reason}, ...]) BEFORE applying any lens — " +
        "all 12 conditional lenses must be accounted for, by canonical name."
      );
    }
  }

  // Deferred messages from the hooks whose output Kimi discards (PostToolUse, Stop
  // warnings): this injection is their only way back into the conversation.
  for (const n of notices) head.push(n);

  head.push(
    `METHODOLOGY: the Phase ${phase} instructions are NOT in this message. If get_phase_guidance() has not ` +
    `been called in this session since the last context compaction or phase change, call it now, before acting.`
  );

  if (state.phase0Score !== null) head.push(`Score Phase 0: ${state.phase0Score}/100`);

  // --- Budgeted context: project spec, then this cycle's decisions (newest first) ---
  const out = [...head];
  let used = out.join("\n").length;
  const room = () => budget - used;
  const add = (line: string): boolean => {
    if (line.length + 1 > room()) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };

  const spec = state.projectSpec;
  if (spec) {
    const list = (label: string, xs: unknown[]) => {
      if (!xs?.length) return;
      const vals = (xs as Parameters<typeof specEntryValue>[0][]).map(specEntryValue);
      let line = `${label}: ${vals.join(", ")}`;
      if (line.length > 600) line = line.slice(0, 597) + "…";
      add(line);
    };
    list("Approved stack", spec.stack);
    list("Out of scope", spec.outOfScope);
    list("Patterns", spec.patterns);
    list("Constraints", spec.constraints);
  }

  const since = engine.cycleStartedAt();
  const cycleDecisions: Decision[] = state.decisions.filter((d) => d.timestamp >= since);
  const older = state.decisions.length - cycleDecisions.length;
  if (cycleDecisions.length) {
    const shown: string[] = [];
    // reserve room for the trailer line
    const trailerRoom = 260;
    for (let i = cycleDecisions.length - 1; i >= 0; i--) {
      const d = cycleDecisions[i];
      const flat = d.content.replace(/\s+/g, " ").trim();
      const text = flat.length > DECISION_SNIPPET ? flat.slice(0, DECISION_SNIPPET - 1) + "…" : flat;
      const line = `  [P${d.phase}/${d.category}${d.approvedBy ? ` ✓${d.approvedBy}` : ""}] ${text}`;
      if (used + 40 + shown.join("\n").length + line.length + trailerRoom > budget) break;
      shown.push(line);
    }
    add(`Decisions this cycle (${shown.length} of ${cycleDecisions.length}, newest first, shortened):`);
    for (const l of shown) add(l);
    const hidden = cycleDecisions.length - shown.length;
    if (hidden > 0 || older > 0 || shown.some((l) => l.endsWith("…"))) {
      add(
        `  (full text: get_decisions()${hidden > 0 ? `; ${hidden} older decision(s) of this cycle not shown` : ""}` +
        `${older > 0 ? `; ${older} decision(s) from earlier cycles: export_cycle(cycle=N)` : ""})`
      );
    }
  }

  return out.join("\n");
}

