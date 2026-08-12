#!/usr/bin/env node

// Layer 3b: Test outcome recorder — PostToolUse / PostToolUseFailure (Bash)
// The counting half of safeguard S6. A PreToolUse hook cannot see the result of
// a run, so the old detector counted executions and blocked the final green run
// — the one moment where running tests is most legitimate (S4 requires it).
// This hook records what the run actually did; a passing run clears the counter.
//
// Bias is deliberate: only positive evidence of failure counts. When the outcome
// is ambiguous it is recorded as `unknown`, which neither satisfies the
// tests_passing gate nor feeds the S6 count — but does overwrite a stale `fail`,
// so a project cannot sit frozen on an outcome nobody produced.

import { createHash } from "crypto";
import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { TestProvenance } from "../state/types";
import {
  readHookInput, resolveWorkspace, toolCommand, toolOutput, queueNotice, pass, HookInput,
} from "../kimi/hook-io";

const TEST_PATTERNS = [
  /\bnpm\s+test\b/i,
  /\bnpx\s+(jest|vitest|mocha)\b/i,
  /\bpytest\b/i,
  /\bpython\s+-m\s+(pytest|unittest)\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bnpm\s+run\s+test\b/i,
  /\bnode\s+.*test/i,
];

function isTestCommand(cmd: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(cmd));
}

// Explicit "nothing failed" statements. Checked FIRST: "0 failed" and
// "failures: 0" contain the word "failed"/"failures" and would otherwise
// trip the failure markers below.
const CLEAN_MARKERS = [
  /\b0\s+(tests?\s+)?fail(ed|ures?|ing)?\b/i,
  /\bfail(ed|ures?)\s*[:=]\s*0\b/i,
  /\ball\s+tests?\s+passed\b/i,
  /\btest\s+result:\s*ok\b/i,          // cargo
  /^ok\s|^PASS\b/im,                    // go test / jest summary line
];

const PASS_MARKERS = [
  /\b\d+\s+(tests?\s+)?pass(ed|ing)\b/i,
  /\btests?:\s+\d+\s+passed/i,
  /\b\d+\s+passed\b/i,
  /=+\s*\d+\s+passed[^=]*=+/i,          // pytest summary
];

const FAIL_MARKERS = [
  /\bexit\s+code:?\s*[1-9]\d*\b/i,
  /\b[1-9]\d*\s+(tests?\s+)?fail(ed|ing|ures?)\b/i,
  /\bfail(ed|ures?)\s*[:=]\s*[1-9]\d*\b/i,
  /\bassertion(error| failed)\b/i,
  /\btest\s+result:\s*FAILED\b/i,
  /^FAIL\b/im,
  /\b(SyntaxError|ReferenceError|TypeError)\b/,
  /\bnpm\s+ERR!/i,
  /✗|✖|×/,
];

export type Outcome = "pass" | "fail" | "unknown";

export function detectOutcome(output: string): Outcome {
  const clean = CLEAN_MARKERS.some((p) => p.test(output));

  // A clean marker does not by itself mean success: "0 failed" can sit next to a
  // crash. Only a failure marker that is NOT explained by the clean phrasing counts.
  const failed = FAIL_MARKERS.some((p) => p.test(output));

  if (failed && !clean) return "fail";
  if (failed && clean) {
    // Both present — e.g. "0 failed" plus a stack trace. Trust the hard signals only.
    const hard = /\bexit\s+code:?\s*[1-9]\d*\b/i.test(output) || /^FAIL\b/im.test(output);
    return hard ? "fail" : "pass";
  }
  if (clean || PASS_MARKERS.some((p) => p.test(output))) return "pass";
  return "unknown";
}

/** A run Kimi ended without ever reporting the command's own exit status. */
const INCONCLUSIVE = [
  /killed by timeout/i,
  /moved to background/i,
  /aborted/i,
  /interrupted by user/i,
];

/**
 * Classifies from the HARNESS signal rather than the reporter's prose.
 *
 * Kimi carries no `exit_code` in the hook payload, but it does carry the
 * equivalent: the Bash tool answers `ok` when the command exited 0 and `error`
 * otherwise, and the runtime turns that into the event name — `PostToolUse` for
 * a clean exit, `PostToolUseFailure` for anything else, with the code itself in
 * the message ("Command failed with exit code: 1"). That is authoritative where
 * the prose is not: a suite whose reporter phrases its summary unusually is
 * still classified correctly.
 *
 * A run Kimi killed (timeout, abort, interrupt) or moved to the background never
 * reported its own status, so it is `unknown` — not `fail`. Blaming the suite for
 * a run nobody observed is exactly the confusion the gate message must avoid.
 *
 * Returns the outcome plus the exit code when it could be read.
 */
export function classify(input: HookInput, output: string): { outcome: Outcome; exitCode?: number; fromHarness: boolean } {
  const failed = input.hook_event_name === "PostToolUseFailure";

  if (!failed && input.hook_event_name === "PostToolUse") {
    return { outcome: "pass", exitCode: 0, fromHarness: true };
  }

  if (failed) {
    const code = output.match(/exit code:?\s*(\d+)/i);
    if (code) return { outcome: "fail", exitCode: parseInt(code[1], 10), fromHarness: true };
    if (INCONCLUSIVE.some((p) => p.test(output))) return { outcome: "unknown", fromHarness: true };
    return { outcome: "fail", fromHarness: true };
  }

  // No recognizable harness signal — fall back to reading the reporter.
  return { outcome: detectOutcome(output), fromHarness: false };
}

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  if (!state || state.currentPhase < 5) pass();

  const command = toolCommand(input);
  if (!isTestCommand(command)) pass();

  try {
    const output = toolOutput(input);
    const { outcome, exitCode, fromHarness } = classify(input, output);

    // Provenance does not prevent forgery — it makes a workaround legible in a
    // post-mortem, which is what a bypassed gate leaves no trace of otherwise.
    const provenance: TestProvenance = {
      source: fromHarness ? "harness" : "unknown",
      toolUseId: input.tool_call_id,
      sessionId: input.session_id,
      outputBytes: Buffer.byteLength(output, "utf-8"),
      outputSha256: createHash("sha256").update(output).digest("hex"),
      exitCode,
    };

    const { count } = engine.recordTestOutcome(command, outcome, provenance);

    // Kimi discards PostToolUse output, so warnings ride along with the next
    // UserPromptSubmit injection instead of landing in the current turn.
    if (outcome === "fail" && count >= LOOP_FAILURE_THRESHOLD) {
      queueNotice(
        workspacePath,
        `[Versus] S6: ${count} consecutive failed runs with no diagnosis recorded. ` +
        `The next test run will be BLOCKED until you name the cause via ` +
        `record_decision(phase=${state.currentPhase}, category='diagnosis', content='...'). ` +
        `If you already know why this failed, record it now and keep going.`
      );
    } else if (outcome === "fail" && count === LOOP_FAILURE_THRESHOLD - 1) {
      queueNotice(
        workspacePath,
        `[Versus] S6: ${count} failed runs in a row with no diagnosis recorded. ` +
        `Record the root cause of this failure with record_decision(category='diagnosis') ` +
        `before the next run, or S6 will block it.`
      );
    } else if (outcome === "unknown") {
      queueNotice(
        workspacePath,
        "[Versus] The last test run ended without a readable result (killed, backgrounded or " +
        "aborted), so it was recorded as unknown: it neither satisfies tests_passing nor counts " +
        "toward S6. Run the suite again in the foreground with an explicit timeout."
      );
    }
  } catch {
    // The command was recognized as a test run, so silence here would leave an
    // older outcome standing for a run that did happen. Record it as unknown.
    try { engine.recordTestOutcome(command, "unknown", { source: "unknown" }); } catch { /* ignore */ }
  }

  pass();
}

// Only run as a hook process — detectOutcome()/classify() are imported by the test suite.
if (require.main === module) {
  main().catch(() => pass());
}
