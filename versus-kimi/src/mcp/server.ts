#!/usr/bin/env node

// MCP Server — standalone process (stdio)
// Started by the VSCode extension or manually via `node server.js --workspace <path>`

import * as fs from "fs";
import * as path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../state/engine";
import { ALL_TOOLS, handleToolCall } from "./tools/index";

function getWorkspacePath(): string {
  // Priority: --workspace arg > VERSUS_WORKSPACE env > server location > cwd.
  //
  // Kimi spawns stdio MCP servers with the session's working directory, so cwd
  // is normally right. The server-location fallback covers the case where it is
  // not: this bundle is deployed to <workspace>/.versus/kimi/server.js, so the
  // workspace is two levels up from __dirname.
  const args = process.argv.slice(2);
  const wsIndex = args.indexOf("--workspace");
  if (wsIndex !== -1 && args[wsIndex + 1]) {
    return args[wsIndex + 1];
  }
  if (process.env.VERSUS_WORKSPACE) {
    return process.env.VERSUS_WORKSPACE;
  }

  const fromLocation = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(fromLocation, ".versus", "state.json"))) {
    return fromLocation;
  }

  return process.cwd();
}

async function main() {
  const workspacePath = getWorkspacePath();
  const engine = new StateEngine(workspacePath);
  engine.load();

  const server = new Server(
    {
      name: "versus-kimi",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      // Reload before every call: the hooks run in separate processes and write
      // state.json behind this server's back — the loop counter and the pass the
      // test-outcome hook witnessed. The engine saves after every mutation, so
      // disk is authoritative; reloading only picks up out-of-process writes.
      engine.load();
      const result = handleToolCall(name, (args ?? {}) as Record<string, unknown>, engine);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Internal error: ${String(err)}` }),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Versus MCP Server fatal: ${String(err)}\n`);
  process.exit(1);
});
