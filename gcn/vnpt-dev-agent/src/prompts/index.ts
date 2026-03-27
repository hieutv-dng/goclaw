import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─────────────────────────────────────────────
// MCP Prompts — Predefined workflow templates
//
// 3 workflows chính:
//   1. implement-task — từ A→Z
//   2. review-code — security + quality check
//   3. close-task — logwork + status + feedback
// ─────────────────────────────────────────────

export function registerPrompts(server: McpServer) {

  // ── Prompt 0: Start (Entry Point) ────────────
  server.prompt(
    "start",
    "Entry point cho developer mới. Hiển thị danh sách task và cho phép chọn.",
    {
      projectRoot: z.string().optional().describe("Đường dẫn codebase (nếu có)")
    },
    async ({ projectRoot }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `# 🏁 Bắt đầu làm việc`,
            ``,
            `Hãy thực hiện tuần tự:`,
            `1. Gọi tool \`list_my_open_issues\` để lấy danh sách task được giao cho tôi.`,
            `2. Hiển thị danh sách task dưới dạng menu lựa chọn [1], [2], [3]... (bao gồm Issue Key và Summary).`,
            `3. Yêu cầu tôi gõ số để chọn task muốn làm.`,
            `4. Sau khi tôi chọn, tự động gọi \`task_kickoff\` cho task đó ${projectRoot ? `với projectRoot="${projectRoot}"` : "và hỏi tôi projectRoot"}.`,
          ].join("\n"),
        },
      }],
    })
  );

  // ── Prompt 1: Implement Task ────────────────
  server.prompt(
    "implement-task",
    "Workflow đầy đủ từ nhận task → implement → commit. " +
    "Dùng khi bắt đầu một task mới.",
    {
      issueKey: z.string()
        .describe("Jira issue key. VD: 'VNPTAI-123'"),
      projectRoot: z.string().optional()
        .describe("Đường dẫn đến codebase. VD: 'D:/projects/my-app'"),
    },
    async ({ issueKey, projectRoot }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `# 🚀 Implement Task: ${issueKey}`,
            "",
            "Hãy thực hiện workflow sau **tuần tự**, hỏi user ở mỗi bước:",
            "",
            "## Bước 1: Khởi tạo",
            `1. Gọi \`task_kickoff\` với issueKey="${issueKey}"${projectRoot ? `, projectRoot="${projectRoot}"` : ""}`,
            "2. Hỏi user các câu hỏi từ kết quả và chờ trả lời",
            "",
            "## Bước 2: Quét docs & context dự án",
            `3. Gọi \`scan_project_docs\` → \`read_project_doc\` cho các file quan trọng`,
            `4. Gọi \`detect_files_from_task\` để tìm file liên quan`,
            "",
            "## Bước 3: Kiểm tra description",
            "5. Gọi `parse_description` → kiểm tra format",
            "6. Nếu thiếu → `generate_gwt_description` → hỏi user duyệt",
            "",
            "## Bước 4: Đánh giá độ phức tạp",
            "7. Gọi `evaluate_task_complexity` → chấm điểm clarity, complexity, AI risk, ước tính giờ",
            "",
            "## Bước 5: Bảo mật",
            "8. Gọi `check_security_flag` → nếu HIGH/CRITICAL → `security_review_checklist`",
            "",
            "## Bước 6: Git + Implement + Commit",
            "9. `suggest_branch_name` → tạo branch → hỏi user confirm",
            "10. Implement → hỏi user review code diff",
            "11. `suggest_commit_message` → commit → hỏi user confirm",
            "",
            "---",
            "⚠️ **Luôn hỏi user trước mỗi bước có side effect!**",
          ].join("\n"),
        },
      }],
    })
  );

  // ── Prompt 2: Review Code ───────────────────
  server.prompt(
    "review-code",
    "Review code trước khi tạo PR. Kiểm tra security, conventions, quality.",
    {
      issueKey: z.string().describe("Jira issue key"),
      projectRoot: z.string().optional().describe("Đường dẫn codebase"),
    },
    async ({ issueKey, projectRoot }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `# 🔍 Code Review: ${issueKey}`,
            "",
            "Thực hiện review theo checklist sau:",
            "",
            "## 1. Security Check",
            `- \`check_security_flag\` với issueKey="${issueKey}"`,
            "- Nếu concern → `security_review_checklist`",
            "",
            "## 2. Convention Check",
            `- \`get_team_context\` → verify conventions${projectRoot ? `\n- \`get_git_standard\` projectRoot="${projectRoot}"` : ""}`,
            "",
            "## 3. File Impact",
            "- `detect_files_from_task` → kiểm tra bỏ sót file",
            "",
            "## 4. Output",
            "- Tạo report: ✅ Passed / ❌ Failed cho mỗi tiêu chí",
          ].join("\n"),
        },
      }],
    })
  );

  // ── Prompt 3: Close Task ────────────────────
  server.prompt(
    "close-task",
    "Workflow đóng task: logwork → status → feedback → metrics. " +
    "Dùng sau khi đã test và merge code.",
    {
      issueKey: z.string().describe("Jira issue key"),
      timeSpent: z.string().describe("Thời gian đã làm. VD: '2h', '1h 30m'"),
      projectRoot: z.string().optional().describe("Đường dẫn codebase"),
    },
    async ({ issueKey, timeSpent, projectRoot }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `# ✅ Close Task: ${issueKey}`,
            "",
            "⚠️ **Hỏi user confirm mỗi bước!**",
            "",
            "## Bước 1: Logwork",
            `1. \`generate_worklog\` issueKey="${issueKey}", timeSpent="${timeSpent}", tested=true${projectRoot ? `, projectRoot="${projectRoot}"` : ""}`,
            "2. Preview → user duyệt → `log_work`",
            "",
            "## Bước 2: Status + Resolution + Comment",
            "3. Hỏi user muốn chuyển sang trạng thái nào (VD: 'Resolved', 'Done')",
            `4. Gọi \`update_issue_status\` với:`,
            `   - \`resolution\`: "Done" (hoặc "Fixed" nếu là Bug)`,
            `   - \`comment\`: Tóm tắt ngắn gọn những gì đã làm (VD: "Fix xong bug X, đã test trên staging")`,
            "",
            "## Bước 3: Feedback",
            "5. Hỏi user ghi feedback → `submit_task_feedback` + `track_metric`",
          ].join("\n"),
        },
      }],
    })
  );
}
