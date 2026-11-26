// MCP Tools: detailed behavioral instructions per phase

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { getPhaseDefinition } from "../../rules/phases";
import { getPhaseGuidanceText } from "../../rules/full-guidance";

export const getPhaseGuidanceTool: Tool = {
  name: "get_phase_guidance",
  description:
    "Returns the methodology guidance for the current (or specified) phase: the global rules, " +
    "activation triggers and anti-patterns, plus that phase's full instructions. This is where " +
    "the methodology text comes from. The per-message context carries only the state and does NOT " +
    "include it. Call it at the start of every session, after every context compaction, and right " +
    "after every advance_phase.",
  inputSchema: {
    type: "object" as const,
    properties: {
      phase: {
        type: "number",
        description: "Phase number (0-7). If omitted, uses the current phase.",
      },
    },
    required: [],
  },
};

export function handleGetPhaseGuidance(engine: StateEngine, args: { phase?: number }): string {
  const state = engine.getPhaseState();
  if (!state) {
    return JSON.stringify({
      error: "Project not initialized. Call init_project first.",
    });
  }

  const phase = args.phase ?? state.currentPhase;

  if (phase < 0 || phase > 7) {
    return JSON.stringify({ error: `Invalid phase: ${phase}. Use 0-7.` });
  }

  // 0.13.0: the real text again. 0.11.0 turned this into a pointer because the complete
  // guidance was injected before every message. In Kimi that injection did arrive whole
  // (55-70K per message in the transcripts) but it was appended to the context on EVERY
  // message, so a 20-message session carried the methodology 20 times. The injection now
  // carries state only, and this tool is where the text comes from. The "~5,700" paging
  // limit behind 0.11.0 was the VS Code chat host's (LocalQwen); Kimi inlines MCP results
  // up to 50,000 chars, and the largest phase here is well under that (a test asserts it).
  return JSON.stringify({
    phase,
    currentPhase: state.currentPhase,
    name: getPhaseDefinition(phase)?.name ?? "Unknown",
    guidance: getPhaseGuidanceText(phase),
  });
}
