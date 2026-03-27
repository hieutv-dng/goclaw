import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Session Context — Task Memory
//
// Lưu và khôi phục context giữa các phiên chat.
// Khi user nói "tiếp tục VNPTAI-123" → load context cũ.
//
// Data lưu tại: .vnpt-dev-agent/sessions/<issueKey>.json
// ─────────────────────────────────────────────

interface SessionData {
  issueKey: string;
  summary: string;
  startedAt: string;
  updatedAt: string;
  status: "kickoff" | "analyzing" | "implementing" | "testing" | "reviewing" | "done";
  stack?: string;
  projectRoot?: string;
  detectedFiles: string[];
  decisions: string[];
  notes: string[];
  branchName?: string;
  securityLevel?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getSessionDir(): Promise<string> {
  const dir = path.resolve(__dirname, "..", "..", ".vnpt-dev-agent", "sessions");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadSession(issueKey: string): Promise<SessionData | null> {
  const dir = await getSessionDir();
  const filePath = path.join(dir, `${issueKey}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

async function saveSession(session: SessionData): Promise<void> {
  const dir = await getSessionDir();
  const filePath = path.join(dir, `${session.issueKey}.json`);
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

// ── Tool registration ──────────────────────────

export function registerSessionTools(server: McpServer) {

  // ── TOOL 1: Lưu session context ─────────────
  server.tool(
    "save_session",
    "Lưu context hiện tại của task để tiếp tục ở phiên chat sau. " +
    "Gọi tool này khi user muốn dừng / chuyển task / hết giờ. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI lưu.",
    {
      issueKey: z.string().describe("Jira issue key"),
      summary: z.string().describe("Tiêu đề task"),
      status: z.enum(["kickoff", "analyzing", "implementing", "testing", "reviewing", "done"])
        .describe("Trạng thái hiện tại của task"),
      projectRoot: z.string().optional().describe("Đường dẫn project"),
      stack: z.string().optional().describe("Tech stack đã detect"),
      detectedFiles: z.array(z.string()).default([])
        .describe("Danh sách file đã tìm thấy liên quan"),
      decisions: z.array(z.string()).default([])
        .describe("Các quyết định đã đưa ra. VD: ['Dùng pattern Observer', 'Skip unit test cho mocking']"),
      notes: z.array(z.string()).default([])
        .describe("Ghi chú tự do"),
      branchName: z.string().optional()
        .describe("Tên branch đã tạo"),
      securityLevel: z.string().optional()
        .describe("Security flag level: NONE/MEDIUM/HIGH/CRITICAL"),
    },
    withErrorHandler("save_session", async (args) => {
      const session: SessionData = {
        issueKey: args.issueKey,
        summary: args.summary,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: args.status,
        projectRoot: args.projectRoot,
        stack: args.stack,
        detectedFiles: args.detectedFiles,
        decisions: args.decisions,
        notes: args.notes,
        branchName: args.branchName,
        securityLevel: args.securityLevel,
      };

      // Load existing → preserve startedAt
      const existing = await loadSession(args.issueKey);
      if (existing) {
        session.startedAt = existing.startedAt;
      }

      await saveSession(session);

      return {
        content: [{
          type: "text",
          text: [
            `# 💾 Session Saved — ${args.issueKey}`,
            "",
            `**Task:** ${args.summary}`,
            `**Status:** ${args.status}`,
            `**Files:** ${args.detectedFiles.length} files tracked`,
            `**Decisions:** ${args.decisions.length} decisions recorded`,
            args.branchName ? `**Branch:** \`${args.branchName}\`` : "",
            "",
            "---",
            '📌 Khi quay lại, nói: _"tiếp tục ' + args.issueKey + '"_ → AI sẽ load context này.',
          ].filter(Boolean).join("\n") + getChainHint("save_session"),
        }],
      };
    })
  );

  // ── TOOL 2: Load session context ────────────
  server.tool(
    "load_session",
    "Khôi phục context đã lưu của một task. " +
    "Gọi khi user nói 'tiếp tục VNPTAI-123' hoặc khi bắt đầu phiên mới.",
    {
      issueKey: z.string().describe("Jira issue key cần load context"),
    },
    withErrorHandler("load_session", async ({ issueKey }) => {
      const session = await loadSession(issueKey);

      if (!session) {
        return {
          content: [{
            type: "text",
            text: [
              `# 📭 Không có session — ${issueKey}`,
              "",
              "Chưa có context nào được lưu cho task này.",
              "",
              "## Gợi ý",
              `- Gọi \`task_kickoff\` để bắt đầu mới`,
              `- Hoặc \`get_issue_detail\` để xem thông tin task`,
            ].join("\n") + getChainHint("load_session"),
          }],
        };
      }

      const age = Math.floor(
        (Date.now() - new Date(session.updatedAt).getTime()) / 3600000
      );

      return {
        content: [{
          type: "text",
          text: [
            `# 📂 Session Restored — ${issueKey}`,
            "",
            `**Task:** ${session.summary}`,
            `**Status:** ${session.status}`,
            `**Last updated:** ${age}h ago (${session.updatedAt})`,
            session.stack ? `**Stack:** ${session.stack}` : "",
            session.projectRoot ? `**Project:** \`${session.projectRoot}\`` : "",
            session.branchName ? `**Branch:** \`${session.branchName}\`` : "",
            session.securityLevel ? `**Security:** ${session.securityLevel}` : "",
            "",

            // Files
            session.detectedFiles.length > 0 ? [
              "## 📁 Files đã track",
              ...session.detectedFiles.map(f => `- \`${f}\``),
            ].join("\n") : "",

            // Decisions
            session.decisions.length > 0 ? [
              "",
              "## 🎯 Quyết định đã đưa ra",
              ...session.decisions.map(d => `- ${d}`),
            ].join("\n") : "",

            // Notes
            session.notes.length > 0 ? [
              "",
              "## 📝 Ghi chú",
              ...session.notes.map(n => `- ${n}`),
            ].join("\n") : "",

            "",
            "---",
            `📌 **Tiếp tục từ bước:** ${getNextStep(session.status)}`,
          ].filter(Boolean).join("\n") + getChainHint("load_session"),
        }],
      };
    })
  );

  // ── TOOL 3: List all sessions ───────────────
  server.tool(
    "list_sessions",
    "Xem danh sách tất cả sessions đang active. " +
    "Dùng khi user hỏi 'tôi đang làm task gì?'",
    {},
    withErrorHandler("list_sessions", async () => {
      const dir = await getSessionDir();
      let files: string[];
      try {
        files = (await fs.readdir(dir)).filter(f => f.endsWith(".json"));
      } catch {
        files = [];
      }

      if (files.length === 0) {
        return {
          content: [{
            type: "text",
            text: "📭 Không có session nào. Bắt đầu task mới bằng `task_kickoff`." + getChainHint("list_sessions"),
          }],
        };
      }

      const sessions: SessionData[] = [];
      for (const file of files) {
        try {
          const raw = await fs.readFile(path.join(dir, file), "utf-8");
          sessions.push(JSON.parse(raw));
        } catch { /* skip corrupted */ }
      }

      // Sort: most recently updated first
      sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      const statusIcon: Record<string, string> = {
        kickoff: "🟡", analyzing: "🔵", implementing: "🟠",
        testing: "🧪", reviewing: "🔍", done: "✅",
      };

      const lines = [
        `# 📋 Active Sessions (${sessions.length})`,
        "",
        "| Status | Issue | Summary | Updated | Files |",
        "|---|---|---|---|---|",
        ...sessions.map(s => {
          const age = Math.floor((Date.now() - new Date(s.updatedAt).getTime()) / 3600000);
          return `| ${statusIcon[s.status] ?? "⬜"} ${s.status} | ${s.issueKey} | ${s.summary.slice(0, 40)} | ${age}h ago | ${s.detectedFiles.length} |`;
        }),
        "",
        "---",
        "Dùng `load_session` với issueKey để tiếp tục task.",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("list_sessions") }],
      };
    })
  );
}

// ── Helper ──────────────────────────────────

function getNextStep(status: string): string {
  const map: Record<string, string> = {
    kickoff: "`get_team_context` → `detect_files_from_task` → implement",
    analyzing: "`detect_files_from_task` → bắt đầu code",
    implementing: "Tiếp tục code → `suggest_commit_message` khi xong",
    testing: "Test xong → `generate_worklog` → `close-task`",
    reviewing: "Review xong → merge → `close-task`",
    done: "Task đã hoàn thành! 🎉",
  };
  return map[status] ?? "Tiếp tục từ nơi dừng lại";
}
