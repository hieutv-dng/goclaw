import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SECURITY_DOMAINS } from "../security/tools.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";
// ─────────────────────────────────────────────
// registerEvaluatorTools
//
// Tool này dùng Claude API để phân tích task
// và trả về đánh giá độ phức tạp, rủi ro,
// thông tin còn thiếu, và ước tính thời gian.
//
// Tại sao gọi Claude API thay vì dùng rule-based?
// → Rule-based chỉ đếm từ, không hiểu ngữ nghĩa.
//   Claude hiểu "implement OAuth2 flow" phức tạp hơn
//   "thêm placeholder vào input" dù số từ tương đương.
// ─────────────────────────────────────────────

const EVALUATOR_SYSTEM_PROMPT = `Bạn là một senior developer chuyên đánh giá task cho AI agent thực thi.
Phân tích task được cung cấp và trả về JSON với cấu trúc SAU ĐÂY, không có gì khác ngoài JSON:

{
  "clarity": {
    "score": <0-100>,
    "level": <"Rất rõ" | "Rõ" | "Mờ" | "Rất mờ">,
    "issues": ["vấn đề 1", "vấn đề 2"]
  },
  "complexity": {
    "score": <0-100>,
    "level": <"Đơn giản" | "Trung bình" | "Phức tạp" | "Rất phức tạp">,
    "reasons": ["lý do 1", "lý do 2"]
  },
  "ai_risk": {
    "score": <0-100>,
    "level": <"Thấp" | "Trung bình" | "Cao" | "Rất cao">,
    "reasons": ["lý do 1", "lý do 2"]
  },
  "recommendation": <"Giao AI implement, human review output" | "Giao AI với hướng dẫn chi tiết hơn" | "Làm rõ yêu cầu trước khi giao AI" | "Nên tự implement, AI chỉ hỗ trợ">,
  "missing_info": ["thông tin còn thiếu 1", "thông tin còn thiếu 2"],
  "estimated_hours": <số giờ thực tế, ví dụ 2.5>,
  "suggested_subtasks": ["subtask 1", "subtask 2", "subtask 3"],
  "description_improvement": "Gợi ý cải thiện description để AI hiểu tốt hơn"
}

Quy tắc đánh giá:
- clarity: Dựa trên mức độ cụ thể của WHAT, WHERE, HOW, DONE WHEN. Nếu thiếu bất kỳ chiều nào → trừ điểm.
- complexity: Dựa trên số file cần sửa, logic nghiệp vụ, side effects, integration points.
- ai_risk: Cao khi task cần hiểu context nghiệp vụ sâu, quyết định kiến trúc, hoặc yêu cầu mơ hồ.
- estimated_hours: Ước tính thực tế cho developer trung bình (không phải AI).
- suggested_subtasks: Phân rã thành 2-5 subtask nhỏ, mỗi subtask AI có thể xử lý độc lập.`;

export function registerEvaluatorTools(server: McpServer) {

 server.tool(
    "evaluate_task_complexity",
    "Thu thập toàn bộ thông tin cần thiết để đánh giá độ phức tạp của task. " +
    "Trả về description đầy đủ, security signals, và các tín hiệu để AI " +
    "tự phân tích: clarity, complexity, AI risk, ước tính giờ, subtasks gợi ý. " +
    "Không gọi external API — Claude đang chat sẽ tự phân tích data trả về.",
    {
      issueKey: z.string(),
      summary: z.string(),
      description: z.string(),
      issueType: z.string().optional(),
      priority: z.string().optional(),
    },
    withErrorHandler("evaluate_task_complexity", async ({ issueKey, summary, description, issueType, priority }) => {
      const text = `${summary} ${description}`.toLowerCase();
      const securityHits: Array<{ domain: string; level: string; description: string }> = [];
 
      for (const [domain, config] of Object.entries(SECURITY_DOMAINS)) {
        if (config.keywords.some((kw) => text.includes(kw))) {
          securityHits.push({ domain, level: config.level, description: config.description });
        }
      }
 
      const securityLevel =
        securityHits.some((h) => h.level === "critical") ? "CRITICAL" :
        securityHits.some((h) => h.level === "high")     ? "HIGH"     :
        securityHits.some((h) => h.level === "medium")   ? "MEDIUM"   : "NONE";
 
      const hasSections = (key: string) =>
        new RegExp(`^## \\[${key}\\]`, "m").test(description);
      const scenarioCount = (description.match(/^### Scenario/gm) ?? []).length;
      const checklistCount = (description.match(/^- \[[ x]\]/gm) ?? []).length;
 
      return {
        content: [{
          type: "text",
          text: [
            `# 📋 Task Data — ${issueKey}`,
            `**Summary:** ${summary}`,
            `**Type:** ${issueType ?? "Task"} | **Priority:** ${priority ?? "Medium"}`,
            "",
            `## 🔐 Security Flag: ${securityLevel}`,
            securityHits.length > 0
              ? securityHits.map((h) => `- **${h.domain}**: ${h.description}`).join("\n")
              : "_Không phát hiện security concern_",
            "",
            `## 📊 Format signals`,
            `- WHY: ${hasSections("WHY") ? "✅" : "❌"}  WHAT: ${hasSections("WHAT") ? "✅" : "❌"}  WHERE: ${hasSections("WHERE") ? "✅" : "❌"}`,
            `- SCENARIOS: ${scenarioCount} scenario(s)  |  DONE_WHEN: ${checklistCount} item(s)`,
            "",
            `## 📝 Description đầy đủ`,
            description || "_Không có description_",
            "",
            `---`,
            `Dựa trên data trên, hãy đánh giá:`,
            `1. **Clarity** (0-100) — description đủ rõ không?`,
            `2. **Complexity** (0-100) — task phức tạp đến mức nào?`,
            `3. **AI Risk** (0-100) — rủi ro khi giao AI implement?`,
            `4. **Giờ ước tính** — thực tế bao lâu?`,
            `5. **Recommendation** — có nên giao AI không?`,
            `6. **Subtasks** — phân rã nếu task lớn`,
          ].join("\n") + getChainHint("evaluate_task_complexity"),
        }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface EvaluationResult {
  clarity: { score: number; level: string; issues: string[] };
  complexity: { score: number; level: string; reasons: string[] };
  ai_risk: { score: number; level: string; reasons: string[] };
  recommendation: string;
  missing_info: string[];
  estimated_hours: number;
  suggested_subtasks: string[];
  description_improvement: string;
}

// ─────────────────────────────────────────────
// Formatter — chuyển JSON → markdown đẹp
// ─────────────────────────────────────────────
function formatEvaluation(
  issueKey: string,
  summary: string,
  r: EvaluationResult,
  securityLevel = "NONE",
  securityHits: Array<{ domain: string; level: string; description: string }> = []
): string {
  const bar = (score: number, len = 10) => {
    const filled = Math.round((score / 100) * len);
    return "█".repeat(filled) + "░".repeat(len - filled);
  };

  const recommendIcon = {
    "Giao AI implement, human review output": "✅",
    "Giao AI với hướng dẫn chi tiết hơn": "🟡",
    "Làm rõ yêu cầu trước khi giao AI": "⚠️",
    "Nên tự implement, AI chỉ hỗ trợ": "🔴",
  }[r.recommendation] ?? "💡";

  const securityEmoji: Record<string, string> = {
    CRITICAL: "🚨", HIGH: "🔴", MEDIUM: "🟡", NONE: "✅",
  };
  const securityAction: Record<string, string> = {
    CRITICAL: "KHÔNG giao AI implement một mình — bắt buộc security review",
    HIGH:     "Giao AI nhưng review kỹ từng dòng code liên quan security",
    MEDIUM:   "Chạy `security_review_checklist` sau khi implement",
    NONE:     "Không có security concern đặc biệt",
  };

  const lines: string[] = [
    `# 📊 Đánh giá task ${issueKey}`,
    `**${summary}**`,
    "",
    "## Chỉ số",
    `- Độ rõ ràng:   ${bar(r.clarity.score)}  ${r.clarity.score}%  → ${r.clarity.level}`,
    `- Độ phức tạp:  ${bar(r.complexity.score)}  ${r.complexity.score}%  → ${r.complexity.level}`,
    `- Rủi ro AI:    ${bar(r.ai_risk.score)}  ${r.ai_risk.score}%  → ${r.ai_risk.level}`,
    "",
    `## ${securityEmoji[securityLevel]} Security Flag: ${securityLevel}`,
    securityAction[securityLevel],
    ...(securityHits.length > 0
      ? ["", ...securityHits.map((h) => `  - **${h.domain}**: ${h.description}`)]
      : []
    ),
    ...(securityLevel !== "NONE"
      ? ["", "_Chạy `security_review_checklist` để có checklist chi tiết_"]
      : []
    ),
    "",
    `## ${recommendIcon} Khuyến nghị`,
    `**${r.recommendation}**`,
    "",
  ];

  // Thông tin còn thiếu
  if (r.missing_info.length > 0) {
    lines.push("## ❓ Thông tin còn thiếu");
    r.missing_info.forEach((m) => lines.push(`  - ${m}`));
    lines.push("");
  }

  // Lý do đánh giá
  if (r.clarity.issues.length > 0) {
    lines.push("## 🔍 Vấn đề về độ rõ ràng");
    r.clarity.issues.forEach((i) => lines.push(`  - ${i}`));
    lines.push("");
  }

  if (r.ai_risk.reasons.length > 0) {
    lines.push("## ⚠️ Rủi ro khi giao AI");
    r.ai_risk.reasons.forEach((r) => lines.push(`  - ${r}`));
    lines.push("");
  }

  // Subtasks gợi ý
  if (r.suggested_subtasks.length > 0) {
    lines.push("## 🔀 Subtasks gợi ý");
    r.suggested_subtasks.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push("");
  }

  // Ước tính & gợi ý cải thiện description
  lines.push(
    `## ⏱️ Ước tính: ${r.estimated_hours}h`,
    "",
    "## 💡 Cải thiện description",
    r.description_improvement,
    "",
    "---",
    "_Dùng `create_issue` để tạo subtasks từ danh sách trên, hoặc `get_issue_detail` để đọc thêm._"
  );

  return lines.join("\n");
}