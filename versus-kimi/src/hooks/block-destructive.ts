#!/usr/bin/env node

// Layer 6: Destructive command blocker — PreToolUse (Bash)
// Blocks rm -rf on root/home/parent, DROP TABLE, force push, .env reads.
// If blocked, user can run the command manually in a separate terminal.
//
// This is also the compensating control that makes Kimi's yolo/auto permission
// modes defensible: auto-approval never reaches a command matched here.

import { readHookInput, toolCommand, deny, pass } from "../kimi/hook-io";

async function main() {
  const input = await readHookInput();
  const command = toolCommand(input);

  if (!command) pass();

  // Block recursive deletion of root, home, or parent directory
  if (/rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|(-[a-zA-Z]*\s+)*)(\/|~|\$HOME|\.\.)/.test(command)) {
    deny(
      "PreToolUse",
      "[Versus] Blocked destructive rm command targeting root, home, or parent directory. " +
      "If intentional, run manually in a separate terminal."
    );
  }

  // Block database destruction
  if (/DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\S+\s*;?\s*$/i.test(command)) {
    deny(
      "PreToolUse",
      "[Versus] Blocked destructive database command (DROP/TRUNCATE/DELETE without WHERE). " +
      "If intentional, run manually in a separate terminal."
    );
  }

  // Block force pushes and hard resets
  if (/git\s+push\s+.*--force|git\s+push\s+-f\b|git\s+reset\s+--hard\s+(HEAD~|origin)/i.test(command)) {
    deny(
      "PreToolUse",
      "[Versus] Blocked force push or hard reset. " +
      "If intentional, run manually in a separate terminal."
    );
  }

  // Block .env file reads (prevent credential exposure)
  if (/(cat|less|head|tail|more|source|grep|sed|awk|bat)\s+\.env\b|echo.*\$\(.*\.env/.test(command)) {
    deny(
      "PreToolUse",
      "[Versus] Blocked .env file access. Credentials should not be read by the agent. " +
      "If needed, run manually in a separate terminal."
    );
  }

  pass();
}

main().catch(() => pass());
