#!/usr/bin/env node

// Layer 1: Context injection — UserPromptSubmit
// Injects methodology STATE before every user message.
//
// 0.13.0: this used to inject the complete guidance (~55-70K) plus every decision of
// every cycle in full. Kimi delivered it whole — UserPromptSubmit output is not capped
// (agent-core-v2 userPrompt.ts) and the transcripts show the guidance arriving to its
// last line — but every injection is appended to the context and stays there, so the
// methodology was repeated once per message. Now: a budgeted state block with the
// must-see lines first, and the guidance comes from get_phase_guidance() (an MCP result,
// inlined up to 50,000 chars by Kimi).
//
// This is also the only channel Versus has back into the conversation: Kimi fires
// PostToolUse as fire-and-forget and discards its output, so those hooks park their
// messages in .versus/notices.json and this one flushes them.

import { StateEngine } from "../state/engine";
import { buildInjection } from "./state-block";
import { readHookInput, resolveWorkspace, drainNotices, emit, pass } from "../kimi/hook-io";

export { buildInjection, INJECT_BUDGET } from "./state-block";

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  if (!engine.getPhaseState()) pass();

  const text = buildInjection(engine, undefined, drainNotices(workspacePath));
  if (text === null) pass();
  emit(text);
}

// Only run as a hook process — buildInjection() is imported by the test suite.
if (require.main === module) {
  main().catch(() => pass());
}
