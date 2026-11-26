#!/usr/bin/env node
// Delivery audit for Kimi Code: what REACHED the model through each Versus channel, read from
// a project's Kimi transcripts (~/.kimi-code/sessions/<workspace id>/session_*/agents/*/wire.jsonl).
//
// Why this exists: the sibling build (Versus Claude) found that for months its per-message
// guidance arrived as a 2,000-char preview and two of its hooks never ran — silently, because
// the tests checked the emitter, not the receiver. Kimi's contract is different (measured from
// Kimi Code 0.9.0, agent-core-v2), and this script is how to keep it measured:
//   - UserPromptSubmit plain stdout is appended whole as <hook_result hook_event="UserPromptSubmit">;
//   - PostToolUse / PostToolUseFailure are fire-and-forget (output discarded), so Versus parks
//     their messages in .versus/notices.json and the next injection carries them;
//   - SessionStart / PreCompact output is awaited and DISCARDED, so Versus registers neither;
//   - the plugin systemPrompt (the session primer) is rebuilt on every request;
//   - an MCP result over 50,000 chars is spilled to a file and the model gets a pointer.
// Run it on a real project after every Kimi Code update and before every Versus release.
//
// Evidence rule: only what the transcript shows the model received counts — the
// context.append_message content, the tool.result output, the profile's systemPrompt.
// Kimi does not log hook stdout, so the emitted side is not in the transcript at all.
//
// Usage: node scripts/audit-delivery.mjs <project-path> [--since YYYY-MM-DD]
// Exit:  0 all channels delivered · 1 no transcripts · 2 a channel failed

import fs from "fs";
import os from "os";
import path from "path";

const args = process.argv.slice(2);
const project = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? Date.parse(args[sinceIdx + 1]) : 0;

const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
const MCP_INLINE_LIMIT = 50_000;        // agent-core-v2 toolContract DEFAULT_TOOL_RESULT_MAX_CHARS
const INJECT_BUDGET = 9_000;            // src/hooks/state-block.ts (a choice, not a host cap)
const PRIMER_MARK = "Versus/IACDM is installed";
const SERVER_PREFIX = "mcp__versus-kimi__";

let workspaces = {};
try {
  workspaces = JSON.parse(fs.readFileSync(path.join(home, "workspaces.json"), "utf-8")).workspaces ?? {};
} catch {
  console.error(`Cannot read ${path.join(home, "workspaces.json")}.`);
  process.exit(1);
}
const ids = Object.entries(workspaces).filter(([, w]) => w && path.resolve(w.root) === project).map(([id]) => id);
const files = [];
for (const id of ids) {
  const dir = path.join(home, "sessions", id);
  if (!fs.existsSync(dir)) continue;
  for (const s of fs.readdirSync(dir).filter((n) => n.startsWith("session_"))) {
    const agents = path.join(dir, s, "agents");
    if (!fs.existsSync(agents)) continue;
    for (const a of fs.readdirSync(agents)) {
      const f = path.join(agents, a, "wire.jsonl");
      if (fs.existsSync(f)) files.push({ session: s, agent: a, file: f });
    }
  }
}
if (!files.length) {
  console.error(`No Kimi transcripts for ${project} (workspace ids: ${ids.join(", ") || "none"}).`);
  process.exit(1);
}

const mcp = new Map();     // tool → { calls, inline, spilled, maxChars }
const gates = new Map();   // refusal prefix → count
const sessions = [];
const failures = [];

const textOf = (out) =>
  typeof out === "string" ? out : Array.isArray(out) ? out.map((p) => (p?.type === "text" ? p.text : "")).join("") : "";

for (const { session, agent, file } of files) {
  const s = {
    session: session.slice(8, 16), agent, primer: false, injections: 0, maxInjection: 0, fullGuidanceInjected: 0,
    guidanceCalls: 0, versions: new Set(), notices: 0, stopBlocks: 0, first: "",
  };
  const names = new Map();
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const t = typeof o.time === "number" ? o.time : typeof o.created_at === "number" ? o.created_at : 0;
    if (since && t && t < since) continue;
    if (!s.first && t) s.first = new Date(t).toISOString().slice(0, 16);

    if ((o.type === "profile.bind" || o.type === "config.update") && typeof o.systemPrompt === "string") {
      if (o.systemPrompt.includes(PRIMER_MARK)) s.primer = true;
    }

    if (o.type === "context.append_message") {
      for (const part of o.message?.content ?? []) {
        const text = typeof part?.text === "string" ? part.text : "";
        for (const m of text.matchAll(/<hook_result hook_event="UserPromptSubmit">\n?([\s\S]*?)\n?<\/hook_result>/g)) {
          const body = m[1];
          if (!body.startsWith("[Versus]")) continue;
          s.injections++;
          s.maxInjection = Math.max(s.maxInjection, body.length);
          if (body.includes("ANTI-PATTERNS")) s.fullGuidanceInjected++;
          const v = /\| v(\d+\.\d+\.\d+)/.exec(body.split("\n")[0]);
          s.versions.add(v ? v[1] : "<0.13.0");
          s.notices += (body.match(/^\[Versus\] (S6|The last test run|WARNING: a previous|Declared check|Not verified|No type-checker)/gm) ?? []).length;
        }
        if (text.includes("Stop verification failed")) s.stopBlocks++;
      }
    }

    if (o.type === "context.append_loop_event") {
      const ev = o.event ?? {};
      if (ev.type === "tool.call" && ev.toolCallId) names.set(ev.toolCallId, ev.name);
      if (ev.type === "tool.result") {
        const name = names.get(ev.toolCallId) ?? "?";
        const out = textOf(ev.result?.output);
        if (out.startsWith("[Versus]")) {
          const k = out.slice(0, 40).replace(/Phase \d/, "Phase N");
          gates.set(k, (gates.get(k) ?? 0) + 1);
          if (out.includes("Stop verification failed")) s.stopBlocks++;
        }
        if (name.startsWith(SERVER_PREFIX)) {
          const tool = name.slice(SERVER_PREFIX.length);
          if (!mcp.has(tool)) mcp.set(tool, { calls: 0, inline: 0, spilled: 0, maxChars: 0 });
          const st = mcp.get(tool);
          st.calls++;
          st.maxChars = Math.max(st.maxChars, out.length);
          const spilled = ev.result?.truncated === true || out.length > MCP_INLINE_LIMIT;
          if (spilled) st.spilled++; else st.inline++;
          if (tool === "get_phase_guidance") s.guidanceCalls++;
        }
      }
    }
  }
  sessions.push(s);
}

console.log(`Kimi delivery audit — ${project}`);
console.log(`${files.length} transcript(s) in ${ids.length} workspace id(s)${since ? `, since ${args[sinceIdx + 1]}` : ""}\n`);

console.log("Per session (agent):");
for (const s of sessions) {
  const v = [...s.versions].join(",") || "—";
  console.log(
    `  ${s.first || "?"}  ${s.session}/${s.agent}  primer:${s.primer ? "yes" : "NO"}  ` +
    `injections:${s.injections} (max ${s.maxInjection}${s.fullGuidanceInjected ? `, ${s.fullGuidanceInjected} with full guidance` : ""})  ` +
    `get_phase_guidance:${s.guidanceCalls}  notices:${s.notices}  stop-blocks:${s.stopBlocks}  version:${v}`
  );
  if (s.agent === "main" && s.injections > 0 && !s.primer) failures.push(`${s.session}: injections arrived but the plugin systemPrompt (primer) did not`);
  if ([...s.versions].some((x) => x !== "<0.13.0") && s.maxInjection > INJECT_BUDGET + 2_000) {
    failures.push(`${s.session}: a 0.13.0+ injection measured ${s.maxInjection} chars, past its ${INJECT_BUDGET} budget`);
  }
}

console.log("\nMCP results (versus-kimi):");
for (const [tool, st] of [...mcp.entries()].sort()) {
  console.log(`  ${tool.padEnd(28)} calls:${st.calls}  inline:${st.inline}  spilled:${st.spilled}  max:${st.maxChars}`);
  if (st.spilled) failures.push(`${tool}: ${st.spilled} result(s) spilled to a file (over ${MCP_INLINE_LIMIT}) — the model got a pointer`);
}

console.log("\nGate / hook texts the model saw in tool results:");
for (const [k, n] of [...gates.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${k}…`);
if (!gates.size) console.log("  (none)");

if (sessions.some((s) => s.fullGuidanceInjected)) {
  console.log("\nNote: sessions with the full guidance in the injection ran a pre-0.13.0 build (delivered whole, but repeated per message).");
}

if (failures.length) {
  console.log("\nFAILED channels:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(2);
}
console.log("\nAll observed channels delivered.");
