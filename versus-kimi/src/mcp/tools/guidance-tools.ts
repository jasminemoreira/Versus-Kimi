// MCP Tools: detailed behavioral instructions per phase

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../../state/engine";
import { getPhaseDefinition } from "../../rules/phases";

export const getPhaseGuidanceTool: Tool = {
  name: "get_phase_guidance",
  description:
    "POINTS you at the instructions for the current or specified phase. The complete " +
    "methodology — global rules, mandatory questions, templates, protocols, checklists " +
    "and criteria — is already injected into your context before every message; this " +
    "tool names the section to read rather than repeating it (repeating it paged the " +
    "result to disk). Call when entering each new phase. Complements get_phase_state.",
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

  // A pointer, not the text. The section ran ~17 KB here — 3x the host's paging
  // limit — and it is pure redundancy: inject-context puts the complete guidance
  // in front of the model before every single message. A tool that spills to disk
  // is strictly worse than one that says where to look.
  const heading = `## Phase ${phase} — ${getPhaseDefinition(phase)?.name ?? "Unknown"}`;

  return JSON.stringify({
    phase,
    currentPhase: state.currentPhase,
    guidancePointer:
      `Phase ${phase} guidance is already in your injected context this turn — read the ` +
      `"${heading}" section and follow it. The full methodology is injected before every ` +
      `message; this tool no longer repeats it inline (it spilled to disk).`,
  });
}
