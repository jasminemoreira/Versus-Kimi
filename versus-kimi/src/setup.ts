// Shared setup utilities — no external dependencies (only fs/path/os).
// Used by both extension.ts (VS Code context) and mcp/tools/project-tools.ts.
//
// Kimi Code splits its configuration across two scopes, and Versus uses both:
//
//   per project   <ws>/.kimi-code/mcp.json             → MCP server
//   per machine   ~/.kimi-code/plugins/installed.json  → hooks
//                 ~/.kimi-code/config.toml             → permissions
//
// Hooks cannot be declared per project — Kimi only reads them from the user
// config or from an installed plugin. Versus ships them as a plugin so they
// live in one removable unit instead of being spliced into the user's TOML.
// The hooks themselves fail open in workspaces with no .versus/state.json, so
// registering them globally does not affect unrelated projects.
//
// Layout inside the workspace follows the convention shared by the sibling
// Versus extensions: .versus/state.json is common ground (so a project can be
// carried between Claude, Qwen and Kimi), while each tool keeps its own
// binaries in .versus/<tool>/. The MCP server is likewise registered in Kimi's
// own file rather than the shared .mcp.json, which Claude Code also reads —
// registering there would make Versus Claude load a second, duplicate
// methodology server whenever both extensions are installed.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const PLUGIN_ID = "versus-kimi";
export const MCP_SERVER_NAME = "versus-kimi";

/** Workspace subdirectory owned by this extension (sibling of qwen/, etc.). */
export const BUNDLE_SUBDIR = path.join(".versus", "kimi");

const SPECS_README_CONTENT = `# specs/ — Material de referência para a metodologia

O assistente (Kimi/Claude/Copilot/Qwen) lê destes diretórios durante as fases
0-7. Popule com conteúdo do seu projeto antes de iniciar cada fase.

## Como operar o Versus

**Retomar contexto:** digite \`retomar Versus\` no chat. O assistente
recarrega a fase atual, decisões e instruções. Use sempre que o chat
perder contexto (reinício do VSCode, conversa longa, trocou de modelo).

**MCP não foi descoberto:** se você já tinha o chat aberto quando
inicializou o projeto, feche e reabra — o MCP server só é detectado ao
iniciar uma nova sessão.

## Subdiretórios

- **domain/** — conhecimento de domínio, glossário, regras de negócio, invariantes
- **references/** — papers, artigos, documentação externa citada no design
- **technical/** — algoritmos, fórmulas, parâmetros numéricos com fontes
- **examples/** — implementações de referência (para port em S6 Tier 2)
- **design/** — mockups, wireframes, referências de UX
- **models/** — modelos de domínio, modelos de dados, relacionamentos
- **datasets/** — dados de teste, entradas de exemplo, saídas esperadas
- **validation/** — critérios de aceitação, cenários de teste, métricas de sucesso
- **competitors/** — produtos similares analisados em P0

## Qual pasta alimenta qual fase

- **Fase 0-1:** domain, references, technical, competitors
- **Fase 1:** + examples, design, models
- **Fase 5:** technical, examples, models, datasets
- **Fase 6:** validation, datasets
`;

/**
 * Writes specs/README.md if it does not already exist.
 * Never overwrites — respects user customizations.
 * Returns true if the file was created.
 */
export function ensureSpecsReadme(workspace: string): boolean {
  const readmePath = path.join(workspace, "specs", "README.md");
  if (fs.existsSync(readmePath)) return false;
  const specsDir = path.dirname(readmePath);
  if (!fs.existsSync(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }
  fs.writeFileSync(readmePath, SPECS_README_CONTENT, "utf-8");
  return true;
}

/**
 * Pins CommonJS for a directory holding deployed bundles.
 *
 * A project whose own package.json declares `"type": "module"` — routine in
 * modern JS projects — makes Node treat every .js under that tree as an ES
 * module, including these CommonJS bundles, which then die with
 * `ReferenceError: require is not defined in ES module scope`. For the MCP
 * server that means no phase state at all: the methodology silently switches
 * off in exactly the projects most likely to use it.
 *
 * Node resolves module type from the nearest package.json, so one file here
 * settles it. Applied to the plugin directory too — the hooks live outside the
 * project and are safe from the project's package.json, but not from a stray
 * one further up the user's home directory.
 *
 * Returns true if the file was created or corrected.
 */
export function pinCommonJs(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  const content = JSON.stringify({ type: "commonjs" }, null, 2) + "\n";

  if (fs.existsSync(pkgPath)) {
    try {
      if (fs.readFileSync(pkgPath, "utf-8") === content) return false;
    } catch { /* unreadable — rewrite */ }
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pkgPath, content, "utf-8");
  return true;
}

/** Kimi Code's home directory (KIMI_CODE_HOME wins, as in the CLI itself). */
export function kimiHome(): string {
  const override = process.env.KIMI_CODE_HOME;
  if (override && override.trim().length > 0) return override;
  return path.join(os.homedir(), ".kimi-code");
}

// ---------------------------------------------------------------------------
// Plugin manifest — hooks
// ---------------------------------------------------------------------------

/**
 * Bundles referenced by the manifest. A hook registered here whose file is
 * missing from the plugin root fails silently, so this list and the deploy
 * list in extension.ts must stay in sync.
 */
export const HOOK_BUNDLES = [
  "inject-context.js",
  "phase-gate.js",
  "loop-detector.js",
  "block-destructive.js",
  "truncation-check.js",
  "test-outcome.js",
  "stop-verify.js",
];

// Kimi reuses Claude Code's tool names, so the matchers carry over verbatim.
// The exceptions elsewhere in the product (WebFetch → FetchURL, Task → Agent)
// are not matched by any Versus hook.
// The system prompt is the only channel that survives everything: it is rebuilt
// on every request, so compaction cannot erase it. That makes it the right place
// for the recovery instruction — Kimi fires PostCompact as fire-and-forget, so a
// hook cannot re-inject anything after the conversation is summarized, and the
// per-message injection only resumes on the user's next prompt.
const SESSION_PRIMER =
  "Versus/IACDM is installed on this machine. If the current workspace contains " +
  ".versus/state.json, it is a Versus project: the methodology state is owned by the " +
  `MCP server "${MCP_SERVER_NAME}" and every methodology interaction MUST go through its ` +
  "tools — get_phase_state() and get_phase_guidance() to load context, record_decision() " +
  "for decisions, update_score() for scoring, mark_exit_criterion() for criteria, " +
  "advance_phase() for transitions. Never read or write .versus/state.json directly. " +
  "If get_phase_state() reports the project is not initialized, read the init_project tool " +
  "description first: it carries a bootstrap protocol for workspaces that already contain " +
  "code.\n" +
  "RECOVERY: the methodology rules are injected with each user message, so a compaction can " +
  "leave you mid-phase without them. If you cannot state the current phase, its exit criteria " +
  "and the decisions already recorded — or if the conversation was just compacted — call " +
  "get_phase_state() and get_phase_guidance() BEFORE your next action, and get_decisions() if " +
  "you are past Phase 0. Do not infer the phase from the conversation: read it from the tools.\n" +
  "If the workspace has no .versus/state.json, ignore all of this — it is not a Versus project " +
  "and nothing about this methodology applies.";

/**
 * Builds the kimi.plugin.json content.
 *
 * Hook commands are absolute so they survive Kimi changing the working
 * directory it hands to plugin hooks (today it is the plugin root). The
 * manifest is rewritten on every activation, so the paths track the installed
 * extension version.
 */
export function buildPluginManifest(pluginRoot: string, version: string): Record<string, any> {
  const hookCommand = (bundle: string) => `node "${path.join(pluginRoot, bundle)}"`;

  return {
    name: PLUGIN_ID,
    version,
    description:
      "IACDM orchestrator for Kimi Code — 8-phase structured development with " +
      "verification gates and safeguards.",
    homepage: "https://github.com/jasminemoreira/Versus",
    license: "MIT",
    systemPrompt: SESSION_PRIMER,
    hooks: [
      { event: "UserPromptSubmit", command: hookCommand("inject-context.js"), timeout: 30 },
      { event: "PreToolUse", matcher: "Write|Edit|EnterPlanMode", command: hookCommand("phase-gate.js"), timeout: 15 },
      { event: "PreToolUse", matcher: "Bash", command: hookCommand("loop-detector.js"), timeout: 15 },
      { event: "PreToolUse", matcher: "Bash", command: hookCommand("block-destructive.js"), timeout: 15 },
      { event: "PostToolUse", matcher: "Grep|Bash", command: hookCommand("truncation-check.js"), timeout: 15 },
      { event: "PostToolUse", matcher: "Bash", command: hookCommand("test-outcome.js"), timeout: 15 },
      { event: "PostToolUseFailure", matcher: "Bash", command: hookCommand("test-outcome.js"), timeout: 15 },
      { event: "Stop", command: hookCommand("stop-verify.js"), timeout: 120 },
    ],
  };
}

/**
 * Writes kimi.plugin.json into the plugin root.
 * Returns true if the file changed.
 */
export function writePluginManifest(pluginRoot: string, version: string): boolean {
  if (!fs.existsSync(pluginRoot)) {
    fs.mkdirSync(pluginRoot, { recursive: true });
  }

  const manifestPath = path.join(pluginRoot, "kimi.plugin.json");
  const content = JSON.stringify(buildPluginManifest(pluginRoot, version), null, 2) + "\n";

  if (fs.existsSync(manifestPath)) {
    try {
      if (fs.readFileSync(manifestPath, "utf-8") === content) return false;
    } catch { /* unreadable — rewrite */ }
  }

  fs.writeFileSync(manifestPath, content, "utf-8");
  return true;
}

/**
 * Registers (or re-points) the plugin in ~/.kimi-code/plugins/installed.json.
 *
 * This is the same registry Kimi's own plugin installer writes; entries are
 * re-parsed from the manifest on every session, so only the identity fields
 * are persisted here. Existing entries for other plugins are preserved.
 * Returns true if the registry changed.
 */
export function ensurePluginRegistration(pluginRoot: string): boolean {
  const registryDir = path.join(kimiHome(), "plugins");
  const registryPath = path.join(registryDir, "installed.json");

  let registry: Record<string, any> = { version: 1, plugins: [] };
  if (fs.existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      if (parsed && Array.isArray(parsed.plugins)) registry = parsed;
    } catch {
      // Corrupt registry: do not clobber a file we cannot understand.
      return false;
    }
  }

  const now = new Date().toISOString();
  const plugins: Record<string, any>[] = registry.plugins;
  const existing = plugins.find((p) => p && p.id === PLUGIN_ID);

  if (existing) {
    if (existing.root === pluginRoot && existing.enabled !== false) return false;
    existing.root = pluginRoot;
    existing.originalSource = pluginRoot;
    existing.source = "local-path";
    existing.enabled = true;
    existing.updatedAt = now;
  } else {
    plugins.push({
      id: PLUGIN_ID,
      root: pluginRoot,
      source: "local-path",
      originalSource: pluginRoot,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    });
  }

  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// MCP registration — per project
// ---------------------------------------------------------------------------

export interface McpConfigResult {
  changed: boolean;
  /** Sibling Versus servers found in .mcp.json and shadowed off for Kimi. */
  shadowed: string[];
}

/**
 * Reads the sibling Versus MCP servers declared in the project-root .mcp.json.
 *
 * Versus Claude registers itself there, and Kimi reads that file too — without
 * intervention a workspace shared by both extensions would expose two full sets
 * of methodology tools to Kimi, both driving the same state.json.
 */
function siblingVersusServers(workspace: string): Record<string, any> {
  const shared = path.join(workspace, ".mcp.json");
  if (!fs.existsSync(shared)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(shared, "utf-8"));
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== "object") return {};

    const out: Record<string, any> = {};
    for (const [name, config] of Object.entries(servers)) {
      if (name === MCP_SERVER_NAME) continue;
      if (!/^versus[-_]/i.test(name)) continue;
      out[name] = config;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Points a project at its LOCAL MCP server (.versus/kimi/server.js).
 *
 * Registered in `<ws>/.kimi-code/mcp.json` — Kimi's own project file — and
 * deliberately NOT in the shared `<root>/.mcp.json`: Claude Code reads that
 * one too, so registering there would make Versus Claude load a second,
 * duplicate methodology server.
 *
 * The reverse collision is handled here: Kimi merges user → project-root
 * .mcp.json → .kimi-code/mcp.json, with later files overriding earlier ones by
 * server name. Any sibling `versus-*` server found in .mcp.json is therefore
 * re-declared here with `enabled: false`, which shadows it for Kimi only —
 * Claude Code never reads this file, so its own setup is untouched.
 *
 * Caveat inherited from Kimi: this file is resolved from the session's working
 * directory, so opening a subdirectory of the project bypasses it. That is the
 * same tradeoff the Qwen build makes with .qwen/settings.json.
 */
export function ensureMcpConfig(workspace: string): McpConfigResult {
  const serverPath = path.join(workspace, BUNDLE_SUBDIR, "server.js");
  const entry = {
    type: "stdio",
    command: "node",
    args: [serverPath],
    env: {},
  };

  const target = path.join(workspace, ".kimi-code", "mcp.json");

  let mcpJson: Record<string, any> = { mcpServers: {} };
  if (fs.existsSync(target)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, "utf-8"));
      mcpJson = parsed && typeof parsed === "object" ? parsed : { mcpServers: {} };
      if (!mcpJson.mcpServers) mcpJson.mcpServers = {};
    } catch {
      mcpJson = { mcpServers: {} };
    }
  }

  const before = JSON.stringify(mcpJson);
  mcpJson.mcpServers[MCP_SERVER_NAME] = entry;

  const siblings = siblingVersusServers(workspace);
  for (const [name, config] of Object.entries(siblings)) {
    mcpJson.mcpServers[name] = { ...(config as object), enabled: false };
  }

  if (JSON.stringify(mcpJson) === before) {
    return { changed: false, shadowed: Object.keys(siblings) };
  }

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(mcpJson, null, 2) + "\n", "utf-8");
  return { changed: true, shadowed: Object.keys(siblings) };
}

// ---------------------------------------------------------------------------
// Permissions — per machine
// ---------------------------------------------------------------------------

const PERMISSION_BLOCK_START = "# >>> versus-kimi (managed) — delete this block to revoke >>>";
const PERMISSION_BLOCK_END = "# <<< versus-kimi (managed) <<<";

// Auto-approved so the methodology's own bookkeeping does not generate an
// approval prompt on every phase transition.
//
// Write and Edit are here on purpose, and the reason is worth recording: the
// phase gate already decides which writes are legitimate, and it is far more
// selective than an approval modal — in Phases 0-4 it refuses everything except
// specs/, .versus/ and scaffolding, and from Phase 5 on, writing code is the
// point. Running both layers means the weaker one can veto the stronger one,
// which is exactly what happened: a background subagent's write to specs/ —
// blessed by the gate, required by rule R4 — died as "Turn cancelled" because
// its approval request surfaced in a queue the user could not attribute to it.
//
// Bash stays out. block-destructive.js catches catastrophes (rm -rf /, DROP
// TABLE, force push), not a `curl | sh`, so shell commands keep going through
// Kimi's own approval flow.
const AUTO_APPROVED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__*`,
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
];

export type PermissionResult = "written" | "updated" | "already-present" | "user-managed" | "manual-merge";

/** The managed block, rendered from the current tool list. */
function permissionBlock(): string {
  return [
    PERMISSION_BLOCK_START,
    "[permission]",
    "allow = [",
    ...AUTO_APPROVED_TOOLS.map((tool) => `  { tool = "${tool}" },`),
    "]",
    PERMISSION_BLOCK_END,
  ].join("\n");
}

/**
 * Writes the Versus permission rules into ~/.kimi-code/config.toml.
 *
 * Kimi has no project-scoped permission file, so this is necessarily global.
 * The block is delimited by markers and rewritten in place when the tool list
 * changes — an extension upgrade that adds a rule must reach existing installs,
 * otherwise the fix ships and nobody gets it.
 *
 * A `[permission]` section that is NOT ours is never touched: a second
 * `[permission]` table would be invalid TOML and would break the whole config,
 * and silently rewriting the user's own rules is worse than doing nothing. In
 * that case the caller reports what to add by hand.
 */
/**
 * Renders our rules as the array-of-tables form Kimi itself writes
 * (`[[permission.rules]]`, one block per rule). Writing the same shape the host
 * serializes to means a later rewrite by Kimi is a no-op on our side.
 */
function permissionRuleBlocks(tools: string[]): string {
  return tools
    .map((tool) => `[[permission.rules]]\ndecision = "allow"\nscope = "user"\npattern = "${tool}"\n`)
    .join("\n");
}

/** Which of our tools already have a rule, in any of the shapes seen in the wild. */
function toolsPresent(content: string, tools: string[]): string[] {
  return tools.filter((tool) => new RegExp(`(pattern|tool)\\s*=\\s*"${escapeForRegex(tool)}"`).test(content));
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Writes the Versus permission rules into ~/.kimi-code/config.toml.
 *
 * Ownership is decided by CONTENT, never by a comment marker. Kimi rewrites this
 * file itself — it re-serializes the rules as `[[permission.rules]]` blocks and
 * drops every comment on the way — so a marker cannot survive a single settings
 * change. A config carrying a rule for `mcp__versus-kimi__*` is ours however it
 * has been re-serialized; a permission section without it belongs to the user and
 * is never touched.
 *
 * Missing rules are appended as new `[[permission.rules]]` blocks, which is valid
 * TOML wherever the file already ends, or spliced into an existing `rules = [...]`
 * array when the config still uses that shape. Anything else returns
 * `manual-merge` rather than guessing at the file's structure.
 */
export function ensureGlobalPermissions(): PermissionResult {
  const home = kimiHome();
  const configPath = path.join(home, "config.toml");

  let content = "";
  if (fs.existsSync(configPath)) {
    try {
      content = fs.readFileSync(configPath, "utf-8");
    } catch {
      return "user-managed";
    }
  }

  const ownershipMark = `mcp__${MCP_SERVER_NAME}__*`;
  const ours = content.includes(ownershipMark);
  const hasPermissionSection = /^\s*\[\[?permission[\].]/m.test(content);

  if (!ours && hasPermissionSection) return "user-managed";

  const missing = AUTO_APPROVED_TOOLS.filter((t) => !toolsPresent(content, AUTO_APPROVED_TOOLS).includes(t));
  if (ours && missing.length === 0) return "already-present";

  if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });

  // Existing `rules = [ … ]` array (the shape this extension used to write):
  // splice into it, so the file keeps one permission section.
  const arrayOpen = content.search(/^\s*(?:rules|allow)\s*=\s*\[/m);
  if (ours && arrayOpen !== -1) {
    const close = content.indexOf("]", arrayOpen);
    if (close === -1) return "manual-merge";
    const lines = missing
      .map((tool) => `  { decision = "allow", scope = "user", pattern = "${tool}" },`)
      .join("\n");
    fs.writeFileSync(configPath, content.slice(0, close) + lines + "\n" + content.slice(close), "utf-8");
    return "updated";
  }

  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  const header = ours ? "" : `${PERMISSION_BLOCK_START}\n`;
  fs.writeFileSync(
    configPath,
    content + separator + "\n" + header + permissionRuleBlocks(missing),
    "utf-8"
  );
  return ours ? "updated" : "written";
}

/** The rules a user has to add by hand when they already manage [permission]. */
export function permissionSnippet(): string {
  return [
    "[permission]",
    "allow = [",
    ...AUTO_APPROVED_TOOLS.map((tool) => `  { tool = "${tool}" },`),
    "]",
  ].join("\n");
}
