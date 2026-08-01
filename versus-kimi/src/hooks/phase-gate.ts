#!/usr/bin/env node

// Layer 2: Tool blocking — PreToolUse (Write|Edit|EnterPlanMode)
// Blocks code editing in Phases 0-4.
// Exceptions: specs/, .versus/, .kimi-code/, package.json, tsconfig.json, README
//
// Also refuses EnterPlanMode inside a Versus project: Kimi's plan mode makes the
// session read-only and declares itself to supersede prior instructions, which
// suspends the methodology mid-phase. Phases 0-4 already ARE the planning
// process, with gates plan mode does not have.

import * as path from "path";
import { StateEngine } from "../state/engine";
import { readHookInput, resolveWorkspace, toolPath, deny, pass } from "../kimi/hook-io";

// Directories that stay writable while the methodology is in its design phases.
// specs/ is not a courtesy: rule R4 *requires* domain material to be deposited
// there during Phase 0, so blocking it would make the phase impossible to complete.
const ALLOWED_DIRS = [
  "specs/",
  ".versus/",
  ".kimi-code/",
  ".claude/",
  ".vscode/",
];

// Project scaffolding and documentation, wherever they sit in the tree.
const ALLOWED_BASENAMES = [
  "package.json",
  ".gitignore",
  ".mcp.json",
  "agents.md",
];

// `.env` is deliberately absent: Kimi refuses it natively as a sensitive file,
// and listing it here would suggest Versus considers writing credentials normal.
const ALLOWED_PREFIXES = ["tsconfig", "readme"];

/**
 * Decides whether a Write/Edit target escapes the phase gate.
 *
 * Kimi's file tools accept relative paths (resolved against the workspace),
 * unlike Claude Code's, which always arrive absolute. Matching allowlist
 * substrings against the raw string therefore rejected the ordinary relative
 * form — `specs/domain/x.md` has no leading slash — and blocked the very writes
 * Phase 0 mandates. The path is normalized to a workspace-relative form first,
 * so both shapes resolve to the same answer.
 *
 * Exported for the test suite.
 */
export function isAllowedPath(rawPath: string, workspace: string): boolean {
  if (!rawPath) return false;

  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(workspace, rawPath);
  const relative = path.relative(workspace, absolute).replace(/\\/g, "/").toLowerCase();

  // Outside the workspace: not project material, and not ours to bless.
  if (relative.startsWith("../")) return false;

  if (ALLOWED_DIRS.some((dir) => relative.startsWith(dir))) return true;

  const basename = path.posix.basename(relative);
  if (ALLOWED_BASENAMES.includes(basename)) return true;
  if (ALLOWED_PREFIXES.some((prefix) => basename.startsWith(prefix))) return true;

  return false;
}

async function main() {
  // Kimi only reveals the session directory in the payload, so the project
  // cannot be located before stdin is read.
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // No project initialized — allow everything
  if (!state) pass();

  // Plan mode would suspend the methodology in any phase, so this one is
  // refused regardless of where the project currently is.
  if (input.tool_name === "EnterPlanMode") {
    deny(
      "PreToolUse",
      `[Versus] Blocked: plan mode is not compatible with an active Versus project ` +
      `(currently Phase ${state.currentPhase}). Kimi's plan mode makes the session read-only ` +
      `and overrides prior instructions, which suspends the methodology mid-phase — including ` +
      `the specs/ writes Phase 0 requires and the implementation Phase 5 exists for.\n` +
      `Phases 0-4 already are the planning process, and they carry gates plan mode does not: ` +
      `exit criteria, convergence score, adversarial critique, safeguards.\n` +
      `Continue in the current phase. If the user explicitly wants Kimi's plan mode, they can ` +
      `toggle it themselves (Shift-Tab) — say so instead of entering it on their behalf.`
    );
  }

  // Phase 5+ allows editing
  if (state.currentPhase >= 5) pass();

  const filePath = toolPath(input);
  if (isAllowedPath(filePath, workspacePath)) pass();

  deny(
    "PreToolUse",
    `[Versus] Blocked: Phase ${state.currentPhase} does not allow writing code or ad-hoc files. ` +
    `File: ${filePath}\n` +
    `Writable in this phase: specs/ (and its subfolders), .versus/, .kimi-code/, plus README, ` +
    `package.json, tsconfig*, .gitignore, AGENTS.md.\n` +
    `If this is domain knowledge, analysis or references (rule R4), write it under the matching ` +
    `specs/ subfolder instead — e.g. specs/domain/, specs/references/, specs/technical/. ` +
    `That path is allowed and is where Phases 0-1 read from.\n` +
    `If it is implementation, complete Phases 0→4 first; get_exit_criteria() shows what is missing. ` +
    `Do not reroute the same write through Bash or another tool: the gate is on the action, not the tool.`
  );
}

// Only run as a hook process — isAllowedPath() is imported by the test suite.
if (require.main === module) {
  main().catch(() => pass());
}
