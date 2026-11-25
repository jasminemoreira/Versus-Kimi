#!/usr/bin/env node

// Layer 3: Loop detection — PreToolUse (Bash)
// Blocks a test run only when the previous LOOP_FAILURE_THRESHOLD runs failed
// with no diagnosis recorded between them. Counting happens in test-outcome.ts
// (PostToolUse), which is the only place the result of a run is visible.
//
// Safeguard S6: "STOP if debugging by trial-and-error instead of naming a cause"

import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { readHookInput, resolveWorkspace, toolCommand, deny, pass } from "../kimi/hook-io";
import { isTestCommand, loadExtraTestPatterns } from "./shell-parse";

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // No project or outside Phase 5-6 — no detection
  if (!state || state.currentPhase < 5) pass();

  // Nothing accumulated, nothing to block.
  if (!engine.isLoopBlocked()) pass();

  const command = toolCommand(input);
  if (!isTestCommand(command, loadExtraTestPatterns(workspacePath))) pass();

  const counter = engine.getLoopCounter();

  deny(
    "PreToolUse",
    `[Versus] Safeguard S6 activated: ${counter.count} consecutive FAILED runs of "${counter.pattern}" ` +
    `with no diagnosis recorded between them (threshold: ${LOOP_FAILURE_THRESHOLD}).\n` +
    `This is the signature of blind debugging — changing things and re-running in the hope one sticks.\n\n` +
    `To continue, name the cause. Call:\n` +
    `  record_decision(phase=${state.currentPhase}, category='diagnosis', content='<root cause of the failure and the fix it implies>')\n` +
    `That clears the counter immediately and the next run goes through.\n\n` +
    `If you cannot name a cause, that IS the finding — S6 applies:\n` +
    `1. Does this bug have a known solution? (Tier 2 — find a reference implementation)\n` +
    `2. Check specs/technical/ and specs/examples/\n` +
    `3. If not found, reconsider the approach and record that as the diagnosis.\n\n` +
    `Note: a PASSING run never counts toward this — verification is never blocked.`
  );
}

main().catch(() => pass());
