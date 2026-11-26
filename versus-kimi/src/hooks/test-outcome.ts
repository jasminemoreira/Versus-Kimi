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
import * as path from "path";
import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { TestProvenance } from "../state/types";
import {
  readHookInput, resolveWorkspace, toolCommand, toolOutput, queueNotice, pass, HookInput,
} from "../kimi/hook-io";
import { isTestCommand, loadExtraTestPatterns, testRunLocation } from "./shell-parse";

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
 * The exit status the command itself echoed: `<test command>; echo "VERSUS_TEST_EXIT=$?"`.
 *
 * This is the only language-agnostic signal available. `$?` is expanded by the
 * shell, not written by the agent or the reporter, so it says the same thing
 * whether the suite prints "2 failed", "2 falharam" or nothing at all. The
 * marker regexes below are English-only and are now a last resort.
 *
 * The LAST occurrence wins: a session that runs the suite twice in one command
 * ends with the status of the final run.
 */
export function detectExitCode(output: string): number | undefined {
  // VERSUS_EXIT (0.13.0) is the general form, also used for declared checks; VERSUS_TEST_EXIT stays valid.
  const ms = [...output.matchAll(/VERSUS_(?:TEST_)?EXIT=(\d+)/g)];
  return ms.length ? parseInt(ms[ms.length - 1][1], 10) : undefined;
}

/**
 * Classifies by observed exit status, falling back to the reporter's prose.
 *
 * **Precedence is echo BEFORE harness here, which inverts the other builds — and
 * it has to be.** Kimi does supply a harness-level signal (the Bash tool answers
 * `ok` on exit 0 and `error` otherwise, which the runtime turns into the event
 * name `PostToolUse` / `PostToolUseFailure`), but that signal reports the status
 * of the COMPOUND command. Once the sanctioned echo is appended, `npm test; echo
 * "VERSUS_TEST_EXIT=$?"` exits 0 no matter how red the suite is — the shell
 * returns the status of the last command, which is the echo. Trusting the event
 * name first would classify every failing suite as a pass, precisely in the setup
 * the guidance now asks for. The echo carries the test command's own status, so
 * it wins; the event name is consulted only when no echo is present.
 *
 * A run Kimi killed (timeout, abort, interrupt) or moved to the background never
 * reported its own status, so it is `unknown` — not `fail`. Blaming the suite for
 * a run nobody observed is exactly the confusion the gate message must avoid.
 * The echo cannot contradict this: `cmd; echo` only prints once cmd has finished,
 * so a killed run leaves no token behind.
 */
export function classify(
  input: HookInput,
  output: string
): { outcome: Outcome; exitCode?: number; exitSource?: "harness" | "echo" } {
  const echoExit = detectExitCode(output);
  if (typeof echoExit === "number") {
    return { outcome: echoExit === 0 ? "pass" : "fail", exitCode: echoExit, exitSource: "echo" };
  }

  const failed = input.hook_event_name === "PostToolUseFailure";

  if (!failed && input.hook_event_name === "PostToolUse") {
    return { outcome: "pass", exitCode: 0, exitSource: "harness" };
  }

  if (failed) {
    const code = output.match(/exit code:?\s*(\d+)/i);
    if (code) return { outcome: "fail", exitCode: parseInt(code[1], 10), exitSource: "harness" };
    if (INCONCLUSIVE.some((p) => p.test(output))) return { outcome: "unknown" };
    return { outcome: "fail", exitSource: "harness" };
  }

  // No exit status observed at all — read the reporter, and accept that this path
  // is English-only. Do NOT extend the markers per language: that is bailing water.
  return { outcome: detectOutcome(output) };
}

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // Every phase: a declared check (0.13.0) can belong to any phase. The test-outcome
  // part below still applies only from Phase 5 on.
  if (!state) pass();

  // Recognized per simple command, heredoc bodies and quoted text excluded — a
  // `cat >> LOG.md <<EOF … npm test … EOF` is a write, not a run, and must not
  // overwrite a witnessed green lastTestOutcome (the ESJUD study's advance_phase(7) failure).
  // The same parse covers PostToolUseFailure: toolCommand() reads the command either way.
  const command = toolCommand(input);
  const extra = loadExtraTestPatterns(workspacePath);
  const isTest = isTestCommand(command, extra);

  // Declared checks: a criterion that declared a mechanical check needs the engine to SEE
  // that command run. Matched on every Bash call, in any phase. Kimi sends at most the
  // first 2,000 chars of tool_output on PostToolUse, so an `output:` expectation is
  // matched against that, and the exit echo is read only if it fits in it.
  try {
    const out = toolOutput(input);
    const hits = engine.witnessChecks(command, out, classify(input, out).exitCode);
    if (hits.length) {
      queueNotice(
        workspacePath,
        `[Versus] Declared check witnessed: ` +
        hits.map((h) => `${h.criterion} (Phase ${h.phase}) ${h.ok ? "✅ expected result" : "❌ NOT the expected result"}`).join("; ") + "."
      );
    }
  } catch { /* never let a check break the hook */ }

  if (!isTest || state.currentPhase < 5) pass();

  try {
    const output = toolOutput(input);
    const { outcome, exitCode, exitSource } = classify(input, output);

    // Provenance does not prevent forgery — it makes a workaround legible in a
    // post-mortem, which is what a bypassed gate leaves no trace of otherwise.
    const provenance: TestProvenance = {
      source: exitSource ? "harness" : "unknown",
      toolUseId: input.tool_call_id,
      sessionId: input.session_id,
      outputBytes: Buffer.byteLength(output, "utf-8"),
      outputSha256: createHash("sha256").update(output).digest("hex"),
      exitCode,
      exitSource,
    };

    // Where the suite actually ran. A pass from outside the project does not satisfy
    // tests_passing (witnessedTestPass), and the record says so. Kimi's Bash tool takes
    // its own `cwd` argument, which overrides the session directory for that call.
    const callCwd = (input.tool_input ?? {})["cwd"];
    const sessionCwd = input.cwd || workspacePath;
    const cwd = typeof callCwd === "string" && callCwd ? path.resolve(sessionCwd, callCwd) : sessionCwd;
    const loc = testRunLocation(command, cwd, workspacePath, extra);
    provenance.cwd = cwd;
    if (loc) {
      provenance.runDir = loc.runDir;
      if (loc.outsideWorkspace) provenance.outsideWorkspace = true;
    }

    const { count } = engine.recordTestOutcome(command, outcome, provenance);

    if (provenance.outsideWorkspace && outcome === "pass") {
      queueNotice(
        workspacePath,
        `[Versus] The last test run happened OUTSIDE the project (ran in ${provenance.runDir}). ` +
        `It is recorded, but it does not count as a witnessed run for tests_passing: run the suite from inside the project.`
      );
      pass();
    }

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
        "[Versus] The last test run ended without a readable exit status, so it was recorded as " +
        "unknown: it neither satisfies tests_passing nor counts toward S6. Re-run it in the " +
        'FOREGROUND with an explicit timeout AND with the exit echo appended — `<your test ' +
        'command>; echo "VERSUS_TEST_EXIT=$?"` — so the engine reads the number the shell ' +
        "produced instead of guessing from the runner's prose. Do not modify the test runner."
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
