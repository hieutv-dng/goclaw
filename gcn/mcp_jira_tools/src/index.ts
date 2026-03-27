import "dotenv/config"; // Load .env trước tất cả mọi thứ
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerJiraTools } from "./jira/tools.js";

// ─────────────────────────────────────────────
// Khởi tạo MCP Server — Jira Tools Only
// ─────────────────────────────────────────────
const server = new McpServer({
  name: "mcp-jira-tools",
  version: "1.0.0",
});

// Đăng ký Jira tools vào server
registerJiraTools(server);

// StdioServerTransport = Claude Desktop giao tiếp
// với MCP qua stdin/stdout (process pipe)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ MCP Jira Tools Server đang chạy...");
}

main().catch((err) => {
  console.error("❌ Lỗi khởi động server:", err);
  process.exit(1);
});
