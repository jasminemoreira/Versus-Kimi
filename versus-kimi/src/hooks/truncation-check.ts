#!/usr/bin/env node

// Layer 5: Truncation detection — PostToolUse (Grep|Bash)
// Detects when tool output was truncated and warns the agent to read the full
// file or narrow its scope before acting on partial results.
//
// Two Kimi constraints shape this hook:
//  - PostToolUse is fire-and-forget, so the warning is queued for the next
//    UserPromptSubmit injection instead of being returned here.
//  - `tool_output` in the payload is capped at 2000 characters, and Kimi
//    appends its truncation markers at the END of the output. A marker past
//    that cap is invisible to us, so detection is best-effort: it catches
//    short-output cases (Grep summaries, persisted-log pointers) and misses
//    long ones. The PreToolUse gates and the S6 counter do not depend on it.

import {
  readHookInput, resolveWorkspace, toolOutput, queueNotice, pass,
} from "../kimi/hook-io";

// Markers Kimi emits when it cuts a tool result short.
const TRUNCATION_MARKERS = [
  /\[stdout truncated at \d+ bytes/i,
  /\[stderr truncated at \d+ bytes/i,
  /\[Truncated at \d+ matches/i,
  /\[Truncated\. Full output:/i,
  /Results truncated to \d+ lines/i,
  /Output is truncated to fit in the message/i,
];

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);
  const output = toolOutput(input);

  if (!output) pass();

  if (TRUNCATION_MARKERS.some((m) => m.test(output))) {
    queueNotice(
      workspacePath,
      "[Versus] WARNING: a previous tool result was truncated — you saw a partial view. " +
      "Read the full file at the path given in the truncation notice, or re-run with " +
      "narrower scope (single directory, stricter pattern) before acting on those results."
    );
    pass();
  }

  // Heuristic: very few grep results for a broad pattern
  if (input.tool_name === "Grep") {
    const resultCount = output.split("\n").filter((l) => l.trim()).length;
    const pattern = (input.tool_input ?? {})["pattern"];

    if (resultCount < 5 && typeof pattern === "string" && pattern.length > 0) {
      queueNotice(
        workspacePath,
        `[Versus] Low result count (${resultCount}) for pattern '${pattern}'. ` +
        "If this seems too few, results may have been truncated or the pattern too strict. " +
        "Consider re-running with narrower directory scope or a looser pattern."
      );
    }
  }

  pass();
}

main().catch(() => pass());
