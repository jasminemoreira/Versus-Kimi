#!/usr/bin/env node

// Layer 4: Stop verification — Stop
// Blocks task completion until project compiles, lints, and tests pass.
// Prevents the LLM from declaring "Done!" with broken code.
// Fail-open: if no toolchain is detected, warns but does not block.

import { StateEngine } from "../state/engine";
import { spawnSync } from "child_process";
import {
  readHookInput, resolveWorkspace, queueNotice, deny, pass,
} from "../kimi/hook-io";

// Total budget for all checks. Kimi kills this hook at 120s (the Stop entry in
// setup.ts buildPluginManifest); stay under it so a slow toolchain yields a clear
// "unverified" note instead of a killed hook.
const TOTAL_BUDGET_MS = 110_000;
const PER_CHECK_MAX_MS = 60_000;
const startedAt = Date.now();

/** Checks that ran out of time. A timeout is NOT a failure: the ESJUD study's Xcode suite
 *  took 120–185s, the hook killed it at 60s and reported "TESTS FAILED" with no error line
 *  in the output — two manual re-runs were green. Timeouts are reported as unverified. */
const timedOut: string[] = [];

function run(cmd: string, args: string[], cwd: string): { ok: boolean; output: string } {
  const label = [cmd, ...args].join(" ");
  const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
  if (remaining < 5_000) {
    timedOut.push(`${label} (not started — time budget exhausted)`);
    return { ok: true, output: "" };
  }
  const budget = Math.min(PER_CHECK_MAX_MS, remaining);
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    timeout: budget,
    shell: true,
  });
  const output = ((result.stdout || "") + (result.stderr || "")).trim();
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err?.code === "ETIMEDOUT" || (result.status === null && result.signal)) {
    timedOut.push(`${label} (exceeded ${Math.round(budget / 1000)}s)`);
    return { ok: true, output };
  }
  return { ok: result.status === 0, output };
}

async function main() {
  const input = await readHookInput();
  const workspacePath = resolveWorkspace(input);

  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // No project initialized — skip verification
  if (!state) pass();

  // Only verify in phases 5+ (implementation/testing)
  if (state.currentPhase < 5) pass();

  // Prevent infinite loop: if this hook already blocked once and the agent
  // retried after fixing, allow through. Kimi also guards this on its side —
  // a Stop hook only re-triggers once per turn.
  if (input.stop_hook_active) pass();

  {
    const fs = require("fs");
    const path = require("path");
    const errors: string[] = [];
    let checksRun = 0;

    // --- TypeScript type-check ---
    if (fs.existsSync(path.join(workspacePath, "tsconfig.json"))) {
      checksRun++;
      const r = run("npx", ["tsc", "--noEmit"], workspacePath);
      if (!r.ok) {
        const lines = r.output.split("\n").slice(0, 30).join("\n");
        errors.push(`TYPE CHECK FAILED:\n${lines}`);
      }
    }

    // --- ESLint ---
    const eslintConfigs = [
      ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml",
      "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
    ];
    if (eslintConfigs.some((c) => fs.existsSync(path.join(workspacePath, c)))) {
      checksRun++;
      const r = run("npx", ["eslint", ".", "--quiet"], workspacePath);
      if (!r.ok) {
        const lines = r.output.split("\n").slice(0, 30).join("\n");
        errors.push(`LINT FAILED:\n${lines}`);
      }
    }

    // --- Python: mypy ---
    const hasPython = ["pyproject.toml", "setup.py", "setup.cfg"]
      .some((f) => fs.existsSync(path.join(workspacePath, f)));
    if (hasPython) {
      const mypyConf = fs.existsSync(path.join(workspacePath, "mypy.ini"));
      let mypyInPyproject = false;
      try {
        const pyproject = fs.readFileSync(path.join(workspacePath, "pyproject.toml"), "utf-8");
        mypyInPyproject = pyproject.includes("[tool.mypy]");
      } catch { /* ignore */ }

      if (mypyConf || mypyInPyproject) {
        checksRun++;
        const r = run("mypy", ["."], workspacePath);
        if (!r.ok) {
          const lines = r.output.split("\n").slice(0, 30).join("\n");
          errors.push(`MYPY FAILED:\n${lines}`);
        }
      }

      // ruff
      const ruffCheck = spawnSync("which", ["ruff"], { encoding: "utf-8", shell: true });
      if (ruffCheck.status === 0) {
        checksRun++;
        const r = run("ruff", ["check", "."], workspacePath);
        if (!r.ok) {
          const lines = r.output.split("\n").slice(0, 30).join("\n");
          errors.push(`RUFF FAILED:\n${lines}`);
        }
      }
    }

    // --- Rust ---
    if (fs.existsSync(path.join(workspacePath, "Cargo.toml"))) {
      checksRun++;
      const r = run("cargo", ["check"], workspacePath);
      if (!r.ok) {
        const lines = r.output.split("\n").slice(0, 30).join("\n");
        errors.push(`CARGO CHECK FAILED:\n${lines}`);
      }
    }

    // --- Test suite ---
    let testRunner = "";
    if (fs.existsSync(path.join(workspacePath, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, "package.json"), "utf-8"));
        const testScript = pkg?.scripts?.test || "";
        if (testScript && !testScript.includes("no test specified")) {
          testRunner = "npm test";
        }
      } catch { /* ignore */ }
    } else if (hasPython) {
      const pytestCheck = spawnSync("which", ["pytest"], { encoding: "utf-8", shell: true });
      if (pytestCheck.status === 0) {
        testRunner = "pytest --tb=short -q";
      }
    } else if (fs.existsSync(path.join(workspacePath, "Cargo.toml"))) {
      testRunner = "cargo test";
    }

    if (testRunner) {
      checksRun++;
      const parts = testRunner.split(" ");
      const r = run(parts[0], parts.slice(1), workspacePath);
      if (!r.ok) {
        const lines = r.output.split("\n").slice(-30).join("\n");
        errors.push(`TESTS FAILED (${testRunner}):\n${lines}`);
      }
    }

    // --- Report ---
    const timeoutNote = timedOut.length
      ? `Not verified — timed out (a timeout is not a failure; run these yourself and report the result): ` +
        `${timedOut.join("; ")}.`
      : "";
    if (errors.length > 0) {
      deny(
        "Stop",
        `[Versus] Stop verification failed (${checksRun} checks ran). ` +
        `Fix these errors before completing:\n\n${errors.join("\n\n")}` +
        (timeoutNote ? `\n\n${timeoutNote}` : "")
      );
    } else if (timeoutNote) {
      // Non-blocking, and Kimi discards non-blocking Stop output — queue it.
      queueNotice(workspacePath, `[Versus] ${timeoutNote} State this to the user.`);
      pass();
    } else if (checksRun === 0) {
      // Not a blocker, and Kimi discards non-blocking Stop output — queue it
      // so the next turn still hears about the unverified completion.
      queueNotice(
        workspacePath,
        "[Versus] No type-checker, linter, or test suite detected. " +
        "Task completion is unverified. State this to the user."
      );
      pass();
    } else {
      pass();
    }
  }
}

main().catch(() => pass());
