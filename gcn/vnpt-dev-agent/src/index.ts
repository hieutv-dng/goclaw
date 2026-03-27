import "dotenv/config"; // Load .env trước tất cả mọi thứ
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerJiraTools } from "./jira/tools.js";
import { registerCodebaseTools } from "./codebase/tools.js";
import { registerEvaluatorTools } from "./evaluator/tools.js";
import { registerTeamContextTools } from "./team-context/tools.js";
import { registerGwtTools } from "./gwt/tools.js";
import { registerSecurityTools } from "./security/tools.js";
import { registerDriftTools } from "./drift/tools.js";
import { registerFeedbackTools } from "./feedback/tools.js";
import { registerMetricsTools } from "./metric-stores/tools.js";
import { registerParserTools } from "./parser/tools.js";
import { registerWorklogTools } from "./gen-logwork/tools.js";
import { registerKickoffTools } from "./kick-off/tools.js";
import { registerGitStandardTools } from "./git-standard/tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { registerPRTools } from "./pr-generator/tools.js";
import { registerSessionTools } from "./session/tools.js";
import { registerQualityGateTools } from "./quality-gate/tools.js";
import { registerTemplateTools } from "./template-gen/tools.js";
import { registerImpactTools } from "./impact-analysis/tools.js";
import { registerEstimationTools } from "./metrics/estimation.js";
import { registerKnowledgeSharingTools } from "./knowledge/sharing.js";
import { registerPluginTools, loadProjectPlugins } from "./plugins/loader.js";
import { registerDocsDiscoveryTools } from "./docs-discovery/tools.js";

// ─────────────────────────────────────────────
// Khởi tạo MCP Server
// McpServer là "bộ não" — nó nhận lệnh từ Claude
// và điều phối tới đúng tool handler
// ─────────────────────────────────────────────
const server = new McpServer({
  name: "vnpt-dev-agent",
  version: "1.0.0",
});

// Đăng ký tất cả Jira tools vào server
registerJiraTools(server);

// Đăng ký Codebase tools (Phase 2)
registerCodebaseTools(server);

// Đăng ký Task Evaluator (Phase 2.5)
registerEvaluatorTools(server);

// Đăng ký Team Context tools (Bổ sung #1)
// ⭐ Tool này được gọi TRƯỚC MỌI task để inject tribal knowledge
registerTeamContextTools(server);

// Đăng ký GWT tools (Bổ sung #2)
registerGwtTools(server);

// Đăng ký Security tools (Bổ sung #3)
registerSecurityTools(server);

// Đăng ký Drift Detection tools (Bổ sung #4)
registerDriftTools(server);

// Đăng ký Feedback Loop tools (Bổ sung #5)
// ⭐ Hệ thống học hỏi theo thời gian
registerFeedbackTools(server);

// Đăng ký Metrics Tracking tools (Bổ sung #7)
// ⭐ Đo ROI thực tế của hệ thống
registerMetricsTools(server);

// Đăng ký Description Parser tools
// ⭐ Entry point chuẩn khi nhận task mới
registerParserTools(server);

// Đăng ký Worklog Generator (template-based, no API)
registerWorklogTools(server);

// Đăng ký Kickoff tools
registerKickoffTools(server);

// Đăng ký Git Standard tools
// ⭐ Đọc quy chuẩn Git từ project hoặc fallback về default
registerGitStandardTools(server);

// Đăng ký MCP Resources (static files AI có thể đọc bất cứ lúc nào)
// ⭐ TEAM_CONTEXT.md, GIT_STANDARD.md, mcp-config.json
registerResources(server);

// Đăng ký MCP Prompts (predefined workflows)
registerPrompts(server);

// Đăng ký PR Generator
registerPRTools(server);

// Đăng ký Session Context (task memory across chat sessions)
registerSessionTools(server);

// Đăng ký Quality Gate (lint/build/test check)
registerQualityGateTools(server);

// Đăng ký Template Generator (boilerplate per stack)
registerTemplateTools(server);

// Đăng ký Impact Analysis (dependency tracking)
registerImpactTools(server);

// Đăng ký Estimation Engine (metrics-based prediction)
registerEstimationTools(server);

// Đăng ký Knowledge Sharing (cross-project tribal knowledge)
registerKnowledgeSharingTools(server);

// Đăng ký Plugin System (dynamic tools from project)
registerPluginTools(server);

// Đăng ký Docs Discovery (auto-scan project docs)
registerDocsDiscoveryTools(server);

// StdioServerTransport = Claude Desktop giao tiếp
// với MCP qua stdin/stdout (process pipe)
// Đây là chuẩn mặc định khi chạy local
async function main() {
  const transport = new StdioServerTransport();
  
  // Tự động load plugins từ folder .mcp-plugins trong thư mục hiện hành
  try {
    const cwd = process.cwd();
    await loadProjectPlugins(server, cwd);
  } catch (e) {
    console.error("⚠️ Không thể load project plugins:", e);
  }

  await server.connect(transport);
  console.error("✅ VNPT Dev Agent MCP Server đang chạy...");
}

main().catch((err) => {
  console.error("❌ Lỗi khởi động server:", err);
  process.exit(1);
});