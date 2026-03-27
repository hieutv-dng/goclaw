import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraClient } from "../jira/client.js";
import { resolveStackProfile } from "../stack-profiles/index.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// task_kickoff — Entry point cho mọi task
//
// Thay vì user phải nhớ prompt dài, tool này:
//   1. Đọc task từ Jira
//   2. Phân tích nhanh (drift, security, format)
//   3. Trả về BỘ CÂU HỎI có cấu trúc
//   4. Claude hỏi user → user chọn
//   5. Claude biết chính xác cần làm gì
//
// User chỉ cần nói: "làm task VNPTAI-123"
// Tool lo phần còn lại.
// ─────────────────────────────────────────────

const CHANGE_KEYWORDS = [
  "thay đổi","đổi lại","changed","updated","actually",
  "không làm","remove","cancel","thay vì","instead","out of scope",
];

export function registerKickoffTools(server: McpServer) {

  server.tool(
    "task_kickoff",
    "Entry point cho mọi task. Đọc Jira task, phân tích nhanh, " +
    "và trả về bộ câu hỏi cần hỏi user TRƯỚC KHI bắt đầu implement. " +
    "Luôn gọi tool này đầu tiên khi user muốn làm một task bất kỳ. " +
    "Sau khi nhận kết quả, hỏi user từng câu hỏi và chờ trả lời trước khi tiếp tục. " +
    "→ Tiếp: get_team_context + detect_files_from_task hoặc generate_gwt_description.",
    {
      issueKey: z.string().describe("Jira issue key. VD: 'VNPTAI-123' hoặc 'GOCONNECT-1260'"),
      projectRoot: z.string().optional()
        .describe("Đường dẫn codebase local. VD: 'D:/projects/my-app'. Bỏ trống nếu chưa biết."),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack. 'auto' = tự detect. Hoặc chỉ định cụ thể."),
    },
    withErrorHandler("task_kickoff", async ({ issueKey, projectRoot, stack }) => {

      // ── 1. Đọc task từ Jira ───────────────────
      const issue = await jiraClient.getIssue(issueKey);
      const fields = issue.fields;
      const summary: string = fields.summary ?? "";
      const description: string = fields.description ?? "";
      const issueType: string = fields.issuetype?.name ?? "Task";
      const status: string = fields.status?.name ?? "";
      const priority: string = fields.priority?.name ?? "Medium";
      const assignee: string = fields.assignee?.displayName ?? "Chưa assign";
      const comments: unknown[] = fields.comment?.comments ?? [];

      // ── 2. Phân tích nhanh (rule-based) ──────

      // Drift check
      const createdDate = new Date(fields.created);
      const updatedDate = new Date(fields.updated);
      const now = new Date();
      const ageInDays = Math.floor((now.getTime() - createdDate.getTime()) / 86400000);
      const daysSinceUpdate = Math.floor((now.getTime() - updatedDate.getTime()) / 86400000);
      const commentsAfterUpdate = (comments as Array<{ created: string; body: string }>)
        .filter(c => new Date(c.created) > updatedDate);
      const changeSignals = (comments as Array<{ body: string }>)
        .filter(c => CHANGE_KEYWORDS.some(kw => c.body.toLowerCase().includes(kw)));
      const hasDriftRisk = ageInDays > 14 && (commentsAfterUpdate.length > 2 || changeSignals.length > 0);

      // Format check
      const hasSections = (key: string) => new RegExp(`^## \\[${key}\\]`, "m").test(description);
      const sectionCount = ["WHY","WHAT","WHERE","HOW","SCENARIOS","DONE_WHEN"]
        .filter(s => hasSections(s)).length;
      const hasGoodFormat = sectionCount >= 4;
      const scenarioCount = (description.match(/^### Scenario/gm) ?? []).length;

      // Security check
      const securityKeywords = ["auth","token","login","password","permission","role","encrypt","pii","cccd"];
      const hasSecurityConcern = securityKeywords.some(kw =>
        `${summary} ${description}`.toLowerCase().includes(kw)
      );

      // Sub-task check
      const isSubTask = issueType === "Sub-task";
      const parentKey = fields.parent?.key;

      // Stack detection
      const profile = projectRoot
        ? await resolveStackProfile(stack, projectRoot)
        : null;

      // ── 3. Xây dựng bộ câu hỏi ───────────────

      // Q1: Mục tiêu làm gì với task này?
      const intentOptions = [
        "Implement đầy đủ từ A-Z (phân tích → code → logwork)",
        "Chỉ phân tích và lên kế hoạch, chưa code",
        "Chỉ generate code, không cần phân tích thêm",
        "Chỉ tạo nhánh git và chuẩn bị môi trường",
      ];

      // Q2: Description quality action
      let descAction = "";
      if (!hasGoodFormat && scenarioCount === 0) {
        descAction = "poor";
      } else if (!hasGoodFormat || scenarioCount < 2) {
        descAction = "partial";
      } else {
        descAction = "good";
      }

      const descOptions =
        descAction === "poor" ? [
          "Nhờ AI gen lại description chuẩn GWT từ mô tả hiện có",
          "Tôi sẽ tự bổ sung description trước, AI chờ tôi",
          "Bỏ qua, implement dựa trên những gì có sẵn",
        ] :
        descAction === "partial" ? [
          "AI bổ sung thêm scenarios còn thiếu",
          "Dùng luôn description hiện tại",
          "Tôi tự sửa, AI chờ tôi",
        ] :
        null; // Good → không cần hỏi

      // Q3: Branch
      const branchOptions = [
        `Tạo nhánh tự động (${issueType === "Bug" ? "fix" : "feat"}/${issueKey.toLowerCase()}-...)`,
        "Tôi tự đặt tên nhánh",
        "Tôi đã có nhánh rồi, không cần tạo",
        "Không cần nhánh (làm trực tiếp trên develop)",
      ];

      // Q4: Project root (nếu chưa biết)
      const rootOptions = projectRoot ? null : [
        "Tôi sẽ cung cấp đường dẫn ngay bây giờ",
        "Bỏ qua bước đọc file context",
      ];

      // ── 4. Format output cho Claude hỏi ──────
      const warnings: string[] = [];
      if (hasDriftRisk) {
        warnings.push(
          `⚠️ **Drift risk:** Task ${ageInDays} ngày tuổi, có ${commentsAfterUpdate.length} comments mới ` +
          `và ${changeSignals.length} dấu hiệu thay đổi yêu cầu.`
        );
      }
      if (hasSecurityConcern) {
        warnings.push(`🔐 **Security:** Task có liên quan đến auth/token/permission — cần review kỹ.`);
      }
      if (isSubTask && parentKey) {
        warnings.push(`� **Sub-task của:** ${parentKey} — nên làm trên nhánh của parent.`);
      }

      return {
        content: [{
          type: "text",
          text: [
            `# 📋 Task Kickoff — ${issueKey}`,
            "",
            `## Thông tin task`,
            `- **Title:** ${summary}`,
            `- **Type:** ${issueType} | **Status:** ${status} | **Priority:** ${priority}`,
            `- **Assignee:** ${assignee}`,
            `- **Description:** ${hasGoodFormat ? `✅ Đủ tốt (${sectionCount}/6 sections, ${scenarioCount} scenarios)` : `⚠️ Thiếu format chuẩn (${sectionCount}/6 sections, ${scenarioCount} scenarios)`}`,
            profile ? `- **Stack:** 🔧 ${profile.displayName} (${profile.name === stack ? "user specified" : "auto-detected"})` : `- **Stack:** ❓ Chưa detect (cần cung cấp projectRoot)`,
            "",
            warnings.length > 0 ? `## ⚠️ Cảnh báo\n${warnings.join("\n")}\n` : "",

            // Description preview ngắn
            description
              ? `## Mô tả hiện tại (tóm tắt)\n${description.slice(0, 300)}${description.length > 300 ? "..." : ""}\n`
              : `## Mô tả hiện tại\n_Không có description_\n`,

            `---`,
            `## 🤖 Hướng dẫn cho Claude`,
            ``,
            `Hãy hỏi user **tuần tự từng câu** sau, chờ trả lời trước khi hỏi câu tiếp theo:`,
            ``,
            `### Câu hỏi 1 — Mục tiêu`,
            `Hỏi: "Bạn muốn làm gì với task **${issueKey}**?"`,
            `Các lựa chọn:`,
            intentOptions.map((o, i) => `  ${i + 1}. ${o}`).join("\n"),
            ``,
            descOptions ? [
              `### Câu hỏi 2 — Description`,
              descAction === "poor"
                ? `Hỏi: "Description của task này còn thiếu nhiều (${sectionCount}/6 sections). Bạn muốn làm gì?"`
                : `Hỏi: "Description có thể bổ sung thêm (${scenarioCount} scenarios). Bạn muốn làm gì?"`,
              `Các lựa chọn:`,
              descOptions.map((o, i) => `  ${i + 1}. ${o}`).join("\n"),
            ].join("\n") : `### Câu hỏi 2 — Description\n_Bỏ qua — description đã đủ tốt_`,
            ``,
            `### Câu hỏi 3 — Nhánh git`,
            `Hỏi: "Bạn cần tạo nhánh git mới không?"`,
            `Các lựa chọn:`,
            branchOptions.map((o, i) => `  ${i + 1}. ${o}`).join("\n"),
            ``,
            rootOptions ? [
              `### Câu hỏi 4 — Project root`,
              `Hỏi: "Đường dẫn đến codebase của bạn ở đâu? (để AI tìm file context)"`,
              `Các lựa chọn:`,
              rootOptions.map((o, i) => `  ${i + 1}. ${o}`).join("\n"),
            ].join("\n") : `### Câu hỏi 4 — Project root\n_Bỏ qua — đã có: ${projectRoot}_`,
            ``,
            `---`,
            `**Sau khi có đủ câu trả lời, hãy tóm tắt lại plan và xin xác nhận trước khi thực hiện.**`,
            ``,
            `---`,
            `📌 **Next step:** → \`scan_project_docs\` + \`detect_files_from_task\` để lấy context, hoặc \`generate_gwt_description\` nếu description chưa chuẩn.`,
          ].filter(s => s !== undefined).join("\n") + getChainHint("task_kickoff"),
        }],
      };
    })
  );
}