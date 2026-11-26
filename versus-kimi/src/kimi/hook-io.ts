// Kimi Code hook runtime — shared I/O contract for every hook process.
//
// Kimi spawns hooks with `shell: true` and pipes a JSON payload on stdin.
// Two details differ from Claude Code and drive this module:
//
// 1. There is no CLAUDE_PROJECT_DIR equivalent. Worse, hooks declared by a
//    plugin run with cwd = the PLUGIN root, not the workspace. The session
//    directory only arrives inside the payload (`cwd`), so every hook must
//    read stdin BEFORE it can decide anything about the project.
// 2. Only two shapes of stdout are honoured: a JSON object carrying
//    `hookSpecificOutput.permissionDecision = "deny"` (blocks the action) or
//    free text (surfaced as context — for UserPromptSubmit only). Exit code 2
//    also blocks, but Kimi reads the reason from stderr in that path.
//
// Everything here fails open: an unreadable payload, a missing project or a
// crash must never stop the user's session.

import * as fs from "fs";
import * as path from "path";

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  // PreToolUse / PostToolUse / PostToolUseFailure
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_call_id?: string;
  tool_output?: string;
  error?: unknown;
  // Stop
  stop_hook_active?: boolean;
  // UserPromptSubmit
  prompt?: string;
}

const STDIN_TIMEOUT_MS = 5000;

/**
 * Reads the JSON payload from stdin. Resolves with an empty object on timeout,
 * empty input or malformed JSON — callers then fall back to cwd-based
 * resolution and permissive behaviour.
 */
export function readHookInput(): Promise<HookInput> {
  return new Promise((resolve) => {
    let raw = "";
    let settled = false;

    const done = (value: HookInput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      process.stdin.destroy();
      done({});
    }, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("error", () => done({}));
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(raw);
        done(typeof parsed === "object" && parsed !== null ? parsed as HookInput : {});
      } catch {
        done({});
      }
    });
  });
}

/**
 * Resolves the Versus workspace for this hook invocation.
 *
 * The payload's `cwd` is the session working directory, which may sit below the
 * project root (Kimi allows opening a subdirectory). Walk up looking for
 * .versus/state.json; if nothing is found, return the starting directory so the
 * caller sees "no project" and stays out of the way.
 */
export function resolveWorkspace(input: HookInput): string {
  const start = typeof input.cwd === "string" && input.cwd.length > 0
    ? input.cwd
    : process.cwd();

  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, ".versus", "state.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

/**
 * Writes all of `text` to stdout synchronously, then the caller may exit.
 *
 * `process.stdout.write()` is asynchronous on a pipe, and `process.exit()` right after
 * it drops whatever had not drained: a piped write was observed cut at 64 KB (Versus
 * Claude 0.18.0). The helpers below are `never` — callers rely on nothing after them
 * running — so instead of exiting in a write callback, the bytes are pushed out here
 * before exit. EAGAIN (non-blocking pipe momentarily full) is retried.
 */
function writeAllSync(text: string): void {
  const buf = Buffer.from(text, "utf-8");
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(1, buf, off);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      throw err;
    }
  }
}

/**
 * Blocks the pending action. Kimi's hook runner (agent-core-v2 runHook.ts) parses stdout
 * against a schema that reads ONLY `message`, `hookSpecificOutput.message`,
 * `hookSpecificOutput.permissionDecision` and `permissionDecisionReason`: a deny blocks a
 * PreToolUse call or a UserPromptSubmit, and on Stop the reason makes the model continue.
 * There is no `additionalContext` and no `systemMessage` in Kimi's contract.
 */
export function deny(event: string, reason: string): never {
  const output = {
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  writeAllSync(JSON.stringify(output) + "\n");
  process.exit(0);
}

/**
 * Emits free text for Kimi to inject as context. Only UserPromptSubmit hooks
 * have their output read back into the conversation — PostToolUse is
 * fire-and-forget, so those hooks must use queueNotice() instead.
 */
export function emit(text: string): never {
  // Plain text, NOT JSON: Kimi parses JSON stdout against its schema, and a JSON object
  // with no `message` key is treated as structured output with nothing to show.
  writeAllSync(text.endsWith("\n") ? text : text + "\n");
  process.exit(0);
}

/** Lets the action through without saying anything. */
export function pass(): never {
  process.exit(0);
}

const NOTICES_FILE = "notices.json";
const MAX_NOTICES = 10;

/**
 * Queues a message for the next UserPromptSubmit injection.
 *
 * Kimi fires PostToolUse and PostToolUseFailure as fire-and-forget: the hook
 * runs, but its stdout is discarded and it cannot block. Anything those hooks
 * need to tell the model has to survive until inject-context runs, so it is
 * parked on disk next to the methodology state.
 */
export function queueNotice(workspace: string, message: string): void {
  const dir = path.join(workspace, ".versus");
  if (!fs.existsSync(dir)) return;

  const file = path.join(dir, NOTICES_FILE);
  let notices: string[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Array.isArray(parsed)) notices = parsed.filter((n) => typeof n === "string");
  } catch { /* missing or corrupt — start fresh */ }

  if (notices.includes(message)) return;
  notices.push(message);

  try {
    fs.writeFileSync(file, JSON.stringify(notices.slice(-MAX_NOTICES), null, 2), "utf-8");
  } catch { /* best effort */ }
}

/** Reads and clears the queued notices. */
export function drainNotices(workspace: string): string[] {
  const file = path.join(workspace, ".versus", NOTICES_FILE);
  if (!fs.existsSync(file)) return [];

  let notices: string[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Array.isArray(parsed)) notices = parsed.filter((n) => typeof n === "string");
  } catch { /* corrupt — drop it */ }

  try {
    fs.unlinkSync(file);
  } catch { /* best effort */ }

  return notices;
}

/**
 * File path targeted by a tool call. Kimi's Read/Write/Edit take `path`;
 * `file_path` is accepted too so a payload from a Claude-shaped client (or a
 * future rename) still resolves.
 */
export function toolPath(input: HookInput): string {
  const args = input.tool_input ?? {};
  const value = args["path"] ?? args["file_path"];
  return typeof value === "string" ? value : "";
}

/** Shell command of a Bash tool call. */
export function toolCommand(input: HookInput): string {
  const value = (input.tool_input ?? {})["command"];
  return typeof value === "string" ? value : "";
}

/**
 * Tool output as text. Kimi sends `tool_output` capped at 2000 characters on
 * PostToolUse, and swaps it for `error` on PostToolUseFailure.
 */
export function toolOutput(input: HookInput): string {
  if (typeof input.tool_output === "string") return input.tool_output;
  if (input.error === undefined || input.error === null) return "";
  return typeof input.error === "string" ? input.error : JSON.stringify(input.error);
}
