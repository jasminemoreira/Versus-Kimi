// Extension Core — lifecycle, component registration
// No files are created in the workspace automatically; everything there depends
// on explicit user action. The Kimi plugin (hooks) is the one exception: it is
// installed per machine on activation, because Kimi has no project-scoped hook
// configuration. It stays inert in workspaces without .versus/state.json.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { SidebarProvider } from "./views/sidebar";
import {
  ensureMcpConfig,
  ensureGlobalPermissions,
  ensureSpecsReadme,
  ensurePluginRegistration,
  writePluginManifest,
  permissionSnippet,
  kimiHome,
  pinCommonJs,
  BUNDLE_SUBDIR,
  HOOK_BUNDLES,
  PLUGIN_ID,
} from "./setup";

let sidebarProvider: SidebarProvider | undefined;
let outputChannel: vscode.OutputChannel;

function log(msg: string) {
  outputChannel?.appendLine(`[Versus Kimi] ${new Date().toISOString()} ${msg}`);
}

function checkPrerequisites(): boolean {
  const missing: string[] = [];
  const nodeOk = (() => {
    const r = spawnSync("node", ["--version"], { encoding: "utf-8" });
    return r.status === 0 && !r.error;
  })();
  const kimiOk = !!vscode.extensions.getExtension("moonshot-ai.kimi-code");

  if (!nodeOk) {
    missing.push("**Node.js** — install from https://nodejs.org/en/download and restart VSCode.");
  }
  if (!kimiOk) {
    missing.push("**Kimi Code** — install from the VSCode Marketplace (publisher: Moonshot AI).");
  }

  if (missing.length > 0) {
    const msg = `Versus Kimi requires the following to work:\n${missing.join("\n")}\nThe extension will not function until these are installed.`;
    const buttons: string[] = [];
    if (!nodeOk) buttons.push("Download Node.js");
    if (!kimiOk) buttons.push("Open Marketplace");
    vscode.window.showErrorMessage(msg, ...buttons).then((action) => {
      if (action === "Download Node.js") {
        vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
      } else if (action === "Open Marketplace") {
        vscode.commands.executeCommand("workbench.extensions.search", "@publisher:moonshot-ai");
      }
    });
    return false;
  }

  return true;
}

/** Plugin root: Kimi's own plugin directory, the same place its installer uses. */
function pluginRoot(): string {
  return path.join(kimiHome(), "plugins", PLUGIN_ID);
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Versus Kimi");
  context.subscriptions.push(outputChannel);
  log("Activating extension...");

  if (!checkPrerequisites()) {
    log("Prerequisites missing — activation aborted.");
    return;
  }

  const version = (context.extension?.packageJSON?.version as string) ?? "0.0.0";

  // Hooks are machine-scoped in Kimi, so the plugin is installed on activation
  // rather than on project init — a project opened later must find it already
  // registered, otherwise the first session runs without any gate.
  try {
    deployPlugin(context.extensionPath, version);
    log(`Plugin deployed and registered at ${pluginRoot()}.`);
  } catch (err) {
    log(`deployPlugin WARNING: ${String(err)}`);
  }

  try {
    const result = ensureGlobalPermissions();
    log(`Global permissions: ${result}.`);
    if (result === "user-managed") {
      vscode.window.showWarningMessage(
        "Versus Kimi: your ~/.kimi-code/config.toml already has a [permission] section, " +
        "so the Versus rules were not added automatically. Add them by hand to avoid an " +
        "approval prompt on every methodology call.",
        "Show rules"
      ).then((action) => {
        if (action === "Show rules") {
          vscode.workspace.openTextDocument({ content: permissionSnippet(), language: "toml" })
            .then((doc) => vscode.window.showTextDocument(doc));
        }
      });
    }
  } catch (err) {
    log(`ensureGlobalPermissions WARNING: ${String(err)}`);
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log("No workspace open — nothing else to do.");
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const extensionPath = context.extensionPath;
  log(`Workspace: ${workspacePath}`);

  try {
    // Register TreeView sidebar (read-only — does not create files)
    sidebarProvider = new SidebarProvider(workspacePath);
    const treeView = vscode.window.createTreeView("versus-kimi.phaseView", {
      treeDataProvider: sidebarProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);
    log("TreeView registered.");

    // Command: manual refresh
    context.subscriptions.push(
      vscode.commands.registerCommand("versus-kimi.refreshView", () => {
        sidebarProvider?.refresh();
      })
    );
    log("Command refreshView registered.");

    // Command: remove the machine-scoped plugin (hooks) without uninstalling
    context.subscriptions.push(
      vscode.commands.registerCommand("versus-kimi.removePlugin", async () => {
        const confirm = await vscode.window.showWarningMessage(
          `Remove the Kimi plugin '${PLUGIN_ID}'? The Versus hooks (phase gate, S6 loop ` +
          "detection, destructive-command blocking, stop verification) stop running in " +
          "every workspace on this machine. Project data is untouched.",
          { modal: true },
          "Remove"
        );
        if (confirm !== "Remove") return;
        try {
          removePlugin();
          vscode.window.showInformationMessage(
            "Versus Kimi: plugin removed. Start a new Kimi conversation for it to take " +
            "effect. Reloading this window reinstalls it."
          );
          log("Plugin removed by user.");
        } catch (err) {
          vscode.window.showErrorMessage(`Versus Kimi: could not remove plugin — ${String(err)}`);
        }
      })
    );

    // Command: initialize project (only way to create files in the workspace)
    context.subscriptions.push(
      vscode.commands.registerCommand("versus-kimi.initProject", async () => {
        const name = await vscode.window.showInputBox({
          prompt: "Project name",
          placeHolder: "my-project",
        });
        if (!name) return;

        const description = await vscode.window.showInputBox({
          prompt: "Brief description",
          placeHolder: "Project description...",
        });
        if (!description) return;

        try {
          const { StateEngine } = await import("./state/engine");
          const engine = new StateEngine(workspacePath);
          const existing = engine.getPhaseState();
          if (existing) {
            vscode.window.showWarningMessage(
              `Project '${existing.projectName}' already exists (Phase ${existing.currentPhase}).`
            );
            return;
          }

          engine.initProject(name, description);

          // Create specs/ directory structure
          const specsDirs = [
            "domain", "references", "technical", "examples",
            "design", "models", "datasets", "validation", "competitors",
          ];
          for (const dir of specsDirs) {
            fs.mkdirSync(path.join(workspacePath, "specs", dir), { recursive: true });
          }
          ensureSpecsReadme(workspacePath);

          // Deploy the MCP server and register it (only now, by user action)
          deployServer(extensionPath, workspacePath);
          const mcp = ensureMcpConfig(workspacePath);
          if (mcp.shadowed.length > 0) {
            log(`Sibling Versus MCP servers shadowed for Kimi: ${mcp.shadowed.join(", ")}.`);
          }

          sidebarProvider?.refresh();
          vscode.window.showInformationMessage(
            `Project '${name}' initialized. Phase 0 — Problem Discovery. Tip: type "retomar Versus" in chat anytime to recover methodology context.`
          );
          vscode.window.showWarningMessage(
            `⚠️ If Kimi Code is already open, start a new conversation so it discovers the MCP server (.kimi-code/mcp.json was just created).`
          );
          vscode.window.showWarningMessage(
            `⚠️ Populate ./specs/ before starting Phase 0 — the AI reads from there. Key dirs: domain, references, technical, examples.`,
            "Open specs/"
          ).then((action) => {
            if (action === "Open specs/") {
              vscode.commands.executeCommand(
                "revealInExplorer",
                vscode.Uri.file(path.join(workspacePath, "specs"))
              );
            }
          });
          log("initProject: completed successfully.");
        } catch (err) {
          log(`initProject ERROR: ${String(err)}`);
          vscode.window.showErrorMessage(`Versus Kimi: Error initializing project: ${String(err)}`);
        }
      })
    );
    log("Command initProject registered.");

    // If the project was already initialized, update the server (maintenance)
    const statePath = path.join(workspacePath, ".versus", "state.json");
    if (fs.existsSync(statePath)) {
      deployServer(extensionPath, workspacePath);
      const mcp = ensureMcpConfig(workspacePath);
      log("Existing project detected — server and .kimi-code/mcp.json updated.");
      if (mcp.shadowed.length > 0) {
        // Another Versus build registered itself in the shared .mcp.json, which
        // Kimi also reads. Left alone, Kimi would see two methodology servers.
        log(`Sibling Versus MCP servers shadowed for Kimi: ${mcp.shadowed.join(", ")}.`);
        vscode.window.showInformationMessage(
          `Versus Kimi: this workspace also has ${mcp.shadowed.join(", ")} registered in .mcp.json. ` +
          "Those servers were disabled for Kimi sessions only, so the methodology tools are not " +
          "duplicated. Claude Code is unaffected."
        );
      }
    } else {
      log("No Versus project in this workspace — nothing to do on activation.");
    }

    log("Activation completed successfully.");
  } catch (err) {
    log(`ACTIVATION ERROR: ${String(err)}`);
    vscode.window.showErrorMessage(`Versus Kimi: Activation error — ${String(err)}`);
  }
}

/**
 * Copies the hook bundles into the Kimi plugin directory, writes the manifest
 * and registers the plugin.
 *
 * The plugin lives under Kimi's home rather than inside the extension so an
 * extension upgrade cannot leave the registry pointing at a deleted path.
 * Removing it is a user action (`Versus Kimi: Remove Plugin`).
 */
function deployPlugin(extensionPath: string, version: string) {
  const bundleDir = path.join(extensionPath, "out", "bundle");
  const targetDir = pluginRoot();

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  pinCommonJs(targetDir);

  for (const file of HOOK_BUNDLES) {
    const src = path.join(bundleDir, file);
    const dest = path.join(targetDir, file);
    if (!fs.existsSync(src)) continue;

    const srcContent = fs.readFileSync(src);
    if (fs.existsSync(dest) && srcContent.equals(fs.readFileSync(dest))) continue;

    fs.writeFileSync(dest, srcContent);
  }

  writePluginManifest(targetDir, version);
  ensurePluginRegistration(targetDir);
}

/** Drops the plugin directory and its registry entry. */
function removePlugin() {
  const registryPath = path.join(kimiHome(), "plugins", "installed.json");
  if (fs.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      if (registry && Array.isArray(registry.plugins)) {
        registry.plugins = registry.plugins.filter((p: any) => !p || p.id !== PLUGIN_ID);
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
      }
    } catch { /* corrupt registry — leave it alone */ }
  }

  fs.rmSync(pluginRoot(), { recursive: true, force: true });
}

/**
 * Copies the MCP server bundle to .versus/kimi/ in the workspace.
 * Only updates if content has changed (idempotent).
 *
 * The subdirectory keeps this build's binaries apart from the sibling Versus
 * extensions (Claude writes .versus/*.js, Qwen writes .versus/qwen/), while
 * .versus/state.json stays shared so a project can move between them.
 */
function deployServer(extensionPath: string, workspacePath: string) {
  const src = path.join(extensionPath, "out", "bundle", "server.js");
  const targetDir = path.join(workspacePath, BUNDLE_SUBDIR);
  const dest = path.join(targetDir, "server.js");

  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  pinCommonJs(targetDir);

  const srcContent = fs.readFileSync(src);
  if (fs.existsSync(dest) && srcContent.equals(fs.readFileSync(dest))) return;

  fs.writeFileSync(dest, srcContent);
}

export function deactivate() {
  sidebarProvider?.dispose();
}
