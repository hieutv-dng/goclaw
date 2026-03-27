import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraClient } from "../jira/client.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Description Drift — Bổ sung #4
//
// Vấn đề: Task tạo 3 tuần trước, requirement đã
// đổi qua Slack/meeting/comment nhưng description
// Jira không được cập nhật → AI đọc description
// cũ → implement sai yêu cầu thực tế.
//
// 2 tools:
//   1. check_description_drift
//      → Phân tích signals drift: thời gian, số comment,
//        keywords thay đổi trong comment
//      → Trả về drift score + cảnh báo cụ thể
//
//   2. extract_latest_requirements
//      → Gọi Claude API đọc description + TẤT CẢ comments
//      → Tổng hợp requirement THỰC TẾ hiện tại
//      → Chỉ ra chỗ nào đã thay đổi so với description gốc
// ─────────────────────────────────────────────

// Keywords trong comment báo hiệu requirement đã thay đổi
const CHANGE_SIGNAL_KEYWORDS = [
  // Thay đổi trực tiếp
  "thay đổi", "đổi lại", "sửa lại", "cập nhật",
  "changed", "updated", "revised", "modified",
  "actually", "wait", "correction", "nevermind",

  // Quyết định mới
  "quyết định", "thống nhất", "đồng ý", "confirmed",
  "decided", "agreed", "aligned",

  // Phủ nhận cũ
  "không làm", "bỏ đi", "remove", "drop", "cancel",
  "không cần", "skip", "ignore the",

  // Thay thế
  "thay vì", "instead", "replace", "switch to",
  "dùng X thay", "use ... instead",

  // Scope change
  "out of scope", "ngoài scope", "move to next sprint",
  "dời sang", "postpone", "defer",
];

// System prompt cho requirements extraction
const EXTRACT_REQUIREMENTS_PROMPT = `Bạn là một BA (Business Analyst) phân tích Jira ticket.

Nhiệm vụ: Đọc description gốc VÀ toàn bộ comments, tổng hợp requirement THỰC TẾ hiện tại.

Trả về JSON sau, không có gì khác:
{
  "has_drift": <true | false>,
  "drift_summary": "tóm tắt 1-2 câu về những gì đã thay đổi, hoặc 'Không phát hiện thay đổi'",
  "original_requirements": ["requirement trong description gốc 1", "requirement 2"],
  "current_requirements": ["requirement THỰC TẾ hiện tại 1 (sau khi tính comment)", "requirement 2"],
  "removed_requirements": ["requirement bị bỏ/hủy 1"],
  "added_requirements": ["requirement mới phát sinh từ comment 1"],
  "changed_requirements": [
    {
      "original": "requirement gốc",
      "current": "requirement đã đổi",
      "source": "comment của ai, ngày nào"
    }
  ],
  "ambiguous_points": ["điểm vẫn còn mơ hồ sau khi đọc hết comments"],
  "recommendation": "Khuyến nghị cho developer trước khi implement"
}

Quy tắc:
- Ưu tiên thông tin trong comment MỚI NHẤT nếu mâu thuẫn với comment cũ hơn
- Comment của PM/PO/BA có trọng số cao hơn comment của dev
- Nếu comment nói "thay đổi" nhưng không rõ thay đổi gì → đưa vào ambiguous_points
- current_requirements là danh sách CUỐI CÙNG developer cần implement`;

export function registerDriftTools(server: McpServer) {

 server.tool(
    "check_description_drift",
    "Phân tích signals drift trong Jira task: tuổi task, số comment sau update, " +
    "keywords thay đổi trong comments. Trả về raw signals để Claude đánh giá " +
    "mức độ drift và khuyến nghị có nên đọc lại requirements không.",
    { issueKey: z.string() },
    withErrorHandler("check_description_drift", async ({ issueKey }) => {
      const issue = await jiraClient.getIssue(issueKey);
      const fields = issue.fields;
      const now = new Date();
      const createdDate = new Date(fields.created);
      const updatedDate = new Date(fields.updated);
 
      const ageInDays = Math.floor((now.getTime() - createdDate.getTime()) / 86400000);
      const daysSinceUpdate = Math.floor((now.getTime() - updatedDate.getTime()) / 86400000);
 
      const comments: Array<{ author: { displayName: string }; body: string; created: string }> =
        fields.comment?.comments ?? [];
 
      const commentsAfterUpdate = comments.filter(
        (c) => new Date(c.created) > updatedDate
      );
 
      const changeSignals = comments.filter((c) =>
        CHANGE_SIGNAL_KEYWORDS.some((kw) => c.body.toLowerCase().includes(kw))
      );
 
      return {
        content: [{
          type: "text",
          text: [
            `# 🔍 Drift Signals — ${issueKey}`,
            "",
            `## Signals định lượng`,
            `- Task age: **${ageInDays} ngày**`,
            `- Description cập nhật: **${daysSinceUpdate} ngày trước**`,
            `- Comments sau update: **${commentsAfterUpdate.length}**`,
            `- Change signal keywords: **${changeSignals.length} comments**`,
            "",
            changeSignals.length > 0 ? [
              `## Comments có dấu hiệu thay đổi`,
              ...changeSignals.slice(0, 5).map((c) => {
                const date = new Date(c.created).toLocaleDateString("vi-VN");
                return `**${c.author.displayName}** — ${date}\n_"${c.body.slice(0, 150)}..."_`;
              }),
              "",
            ].join("\n") : "",
            commentsAfterUpdate.length > 0 ? [
              `## ${commentsAfterUpdate.length} Comments sau lần update description`,
              ...commentsAfterUpdate.slice(-5).map((c) => {
                const date = new Date(c.created).toLocaleDateString("vi-VN");
                return `**${c.author.displayName}** — ${date}\n${c.body.slice(0, 200)}`;
              }),
            ].join("\n\n") : "",
            "",
            `---`,
            `Dựa vào signals trên, hãy đánh giá:`,
            `- Drift score (0-100)`,
            `- Mức độ: HIGH/MEDIUM/LOW`,
            `- Có cần chạy extract_latest_requirements không?`,
          ].filter(Boolean).join("\n") + getChainHint("check_description_drift"),
        }],
      };
    })
  );
 
  server.tool(
    "extract_latest_requirements",
    "Đọc description gốc VÀ toàn bộ comments của Jira task. " +
    "Trả về raw data để Claude tổng hợp requirement thực tế hiện tại, " +
    "xác định requirement đã thay đổi, bị hủy, hoặc phát sinh mới.",
    { issueKey: z.string() },
    withErrorHandler("extract_latest_requirements", async ({ issueKey }) => {
      const issue = await jiraClient.getIssue(issueKey);
      const fields = issue.fields;
      const comments: Array<{ author: { displayName: string }; body: string; created: string }> =
        fields.comment?.comments ?? [];
 
      const commentsText = comments.map((c, i) => {
        const date = new Date(c.created).toLocaleDateString("vi-VN");
        return `[Comment ${i + 1}] ${c.author.displayName} — ${date}\n${c.body}`;
      }).join("\n\n---\n\n");
 
      return {
        content: [{
          type: "text",
          text: [
            `# 📋 Full Requirements Data — ${issueKey}`,
            `**${fields.summary}**`,
            "",
            `## Description gốc`,
            fields.description || "_Không có description_",
            "",
            comments.length > 0 ? [
              `## Toàn bộ Comments (${comments.length})`,
              commentsText,
            ].join("\n") : "_Không có comments_",
            "",
            `---`,
            `Hãy tổng hợp requirements thực tế hiện tại:`,
            `- **has_drift**: description gốc có còn accurate không?`,
            `- **current_requirements**: danh sách requirement THỰC TẾ cần implement`,
            `- **removed**: requirement bị hủy/bỏ`,
            `- **added**: requirement mới phát sinh từ comments`,
            `- **changed**: requirement đã thay đổi (gốc → hiện tại)`,
            `- **ambiguous**: điểm vẫn còn mơ hồ cần hỏi lại`,
            `- **recommendation**: khuyến nghị trước khi implement`,
          ].filter(Boolean).join("\n") + getChainHint("extract_latest_requirements"),
        }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Types & Formatter
// ─────────────────────────────────────────────

interface DriftAnalysisResult {
  has_drift: boolean;
  drift_summary: string;
  original_requirements: string[];
  current_requirements: string[];
  removed_requirements: string[];
  added_requirements: string[];
  changed_requirements: Array<{
    original: string;
    current: string;
    source: string;
  }>;
  ambiguous_points: string[];
  recommendation: string;
}

function formatDriftAnalysis(
  issueKey: string,
  summary: string,
  r: DriftAnalysisResult
): string {
  const lines: string[] = [
    `# 📋 Requirements thực tế — ${issueKey}`,
    `**${summary}**`,
    "",
    r.has_drift
      ? "⚠️ **Phát hiện drift** — Description gốc không còn phản ánh đúng requirement hiện tại"
      : "✅ **Không có drift** — Description gốc vẫn còn accurate",
    "",
    `_${r.drift_summary}_`,
    "",
  ];

  // Current requirements — quan trọng nhất
  lines.push("## ✅ Requirement THỰC TẾ cần implement");
  r.current_requirements.forEach((req, i) =>
    lines.push(`${i + 1}. ${req}`)
  );
  lines.push("");

  // Changed
  if (r.changed_requirements.length > 0) {
    lines.push("## 🔄 Đã thay đổi so với description gốc");
    for (const c of r.changed_requirements) {
      lines.push(
        `\n**Gốc:** ~~${c.original}~~`,
        `**Hiện tại:** ${c.current}`,
        `**Nguồn:** _${c.source}_`
      );
    }
    lines.push("");
  }

  // Added
  if (r.added_requirements.length > 0) {
    lines.push("## ➕ Phát sinh thêm (chỉ có trong comments)");
    r.added_requirements.forEach((req) => lines.push(`- ${req}`));
    lines.push("");
  }

  // Removed
  if (r.removed_requirements.length > 0) {
    lines.push("## ❌ Đã bị hủy/bỏ");
    r.removed_requirements.forEach((req) => lines.push(`- ~~${req}~~`));
    lines.push("");
  }

  // Ambiguous — cần hỏi lại trước khi implement
  if (r.ambiguous_points.length > 0) {
    lines.push("## ❓ Vẫn còn mơ hồ — cần hỏi lại trước khi implement");
    r.ambiguous_points.forEach((point) => lines.push(`- ${point}`));
    lines.push("");
  }

  lines.push(
    "---",
    "## 💡 Khuyến nghị",
    r.recommendation,
    "",
    r.ambiguous_points.length > 0
      ? "⚠️ **Hỏi lại các điểm mơ hồ trên trước khi giao AI implement.**"
      : "✅ **Có thể giao AI implement dựa trên danh sách requirement thực tế ở trên.**",
  );

  return lines.join("\n");
}