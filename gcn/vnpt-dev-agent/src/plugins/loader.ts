import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { withErrorHandler, getChainHint } from "../shared/index.js";
// ─────────────────────────────────────────────
// Plugin System
//
// Cho phép project tự extend MCP bằng cách
// viết thêm tools trong folder .mcp-plugins/
// ─────────────────────────────────────────────

interface McpPlugin {
  name: string;
  version: string;
  registerTools?: (server: McpServer) => void;
  registerPrompts?: (server: McpServer) => void;
  registerResources?: (server: McpServer) => void;
}

export async function loadProjectPlugins(server: McpServer, projectRoot: string) {
  const pluginDir = path.join(projectRoot, ".mcp-plugins");
  
  try {
    await fs.access(pluginDir);
  } catch {
    // No plugins folder, nothing to do
    return;
  }

  const files = (await fs.readdir(pluginDir)).filter(f => f.endsWith(".plugin.js") || f.endsWith(".plugin.mjs"));
  
  for (const file of files) {
    const filePath = path.join(pluginDir, file);
    const fileUrl = pathToFileURL(filePath).href;

    try {
      const plugin: McpPlugin = (await import(fileUrl)).default;
      
      if (plugin.registerTools) {
        plugin.registerTools(server);
      }
      if (plugin.registerPrompts) {
        plugin.registerPrompts(server);
      }
      if (plugin.registerResources) {
        plugin.registerResources(server);
      }
      
      console.error(`📦 Plugin loaded: ${plugin.name} v${plugin.version} từ ${file}`);
    } catch (err) {
      console.error(`❌ Failed to load plugin ${file}:`, err);
    }
  }
}

// ── Tool registration ──────────────────────────
// Để AI có thể scan và load plugins mới khi đang chạy

export function registerPluginTools(server: McpServer) {

  server.tool(
    "reload_plugins",
    "Scan và load lại plugins từ folder `.mcp-plugins/` trong project root. " +
    "Dùng khi bạn vừa tạo thêm tool mới trong plugin.",
    {
      projectRoot: z.string().describe("Đường dẫn project root"),
    },
    withErrorHandler("reload_plugins", async ({ projectRoot }) => {
      await loadProjectPlugins(server, projectRoot);
      return {
        content: [{ type: "text", text: "✅ Đã scan và reload plugins từ project." + getChainHint("reload_plugins") }],
      };
    })
  );
}

import { z } from "zod";
