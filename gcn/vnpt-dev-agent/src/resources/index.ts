import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ─────────────────────────────────────────────
// MCP Resources — expose key files cho AI đọc
//
// Resources là file tĩnh mà AI có thể đọc
// bất cứ lúc nào mà không cần gọi tool.
//
// 1. TEAM_CONTEXT.md — tribal knowledge
// 2. GIT_STANDARD.md — quy chuẩn git
// 3. mcp-config.json — cấu hình MCP
// ─────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

export function registerResources(server: McpServer) {

  // ── Resource 1: TEAM_CONTEXT.md ──────────────
  server.resource(
    "team-context",
    "team://context",
    {
      description:
        "Tribal knowledge của team: architecture rules, service patterns, " +
        "forbidden patterns, naming conventions. Đọc TRƯỚC KHI implement.",
      mimeType: "text/markdown",
    },
    async () => {
      const candidates = [
        path.join(ROOT, "TEAM_CONTEXT.md"),
        path.join(ROOT, "docs", "TEAM_CONTEXT.md"),
      ];

      for (const filePath of candidates) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          return {
            contents: [{
              uri: "team://context",
              mimeType: "text/markdown",
              text: content,
            }],
          };
        } catch { /* try next */ }
      }

      return {
        contents: [{
          uri: "team://context",
          mimeType: "text/plain",
          text: "TEAM_CONTEXT.md chưa được tạo. Dùng tool `get_team_context` để khởi tạo.",
        }],
      };
    }
  );

  // ── Resource 2: GIT_STANDARD.md ──────────────
  server.resource(
    "git-standard",
    "git://standard",
    {
      description:
        "Quy chuẩn Git: branch naming, commit message, workflow. " +
        "Tham khảo TRƯỚC KHI tạo branch hoặc commit.",
      mimeType: "text/markdown",
    },
    async () => {
      const candidates = [
        path.join(ROOT, "GIT_STANDARD.md"),
        path.join(ROOT, "docs", "GIT_STANDARD.md"),
        path.join(ROOT, "docs", "GIT_STANDARD.md"),
      ];

      for (const filePath of candidates) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          return {
            contents: [{
              uri: "git://standard",
              mimeType: "text/markdown",
              text: content,
            }],
          };
        } catch { /* try next */ }
      }

      return {
        contents: [{
          uri: "git://standard",
          mimeType: "text/plain",
          text: "Không tìm thấy file quy chuẩn Git. Dùng tool `get_git_standard` để tìm.",
        }],
      };
    }
  );

  // ── Resource 3: mcp-config.json ──────────────
  server.resource(
    "mcp-config",
    "config://mcp",
    {
      description:
        "Cấu hình MCP server: defaults, paths, safety rules, git prefixes.",
      mimeType: "application/json",
    },
    async () => {
      const configPath = path.join(ROOT, "mcp-config.json");
      try {
        const content = await fs.readFile(configPath, "utf-8");
        return {
          contents: [{
            uri: "config://mcp",
            mimeType: "application/json",
            text: content,
          }],
        };
      } catch {
        return {
          contents: [{
            uri: "config://mcp",
            mimeType: "text/plain",
            text: "mcp-config.json không tìm thấy.",
          }],
        };
      }
    }
  );
}
