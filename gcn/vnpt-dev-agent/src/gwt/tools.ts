import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// registerGwtTools
//
// 2 tools xử lý vấn đề "description mờ":
//
// 1. generate_gwt_description
//    → Nhận mô tả mờ → gọi Claude API
//    → Trả về description chuẩn GWT
//    → Có thể update thẳng lên Jira
//
// 2. validate_description_quality
//    → Chấm điểm description hiện tại
//    → Chỉ ra chính xác chỗ nào còn mơ hồ
//    → Gợi ý cách sửa cụ thể
// ─────────────────────────────────────────────

// ── System prompts ────────────────────────────

const GWT_GENERATOR_PROMPT = `Bạn là một senior developer chuyên viết acceptance criteria theo format Given/When/Then (GWT) cho software project.

Nhiệm vụ: Chuyển đổi mô tả task mơ hồ thành description chuẩn GWT mà AI có thể implement chính xác.

Quy tắc bắt buộc:
1. Mỗi "Then" phải là hành vi CỤ THỂ, có thể test được — không dùng từ mơ hồ
2. Luôn có: happy path, ít nhất 1 error case, ít nhất 1 edge case
3. Nếu có UI → mô tả màu sắc, vị trí, text cụ thể
4. Nếu có API → đặt tên endpoint, request/response format
5. Nếu có validation → mô tả chính xác rule validate
6. Section "Technical Notes" phải có tên file/module liên quan

Trả về ĐÚNG format sau (markdown, không thêm gì khác):

## Mục tiêu nghiệp vụ
[1 câu WHY]

## Acceptance Criteria

### Scenario 1: [Happy path]
**Given** [trạng thái ban đầu]
**When**  [hành động]
**Then**  [kết quả cụ thể, mỗi kết quả 1 dòng]

### Scenario 2: [Error case]
...

### Scenario N: [Edge case]
...

## Technical Notes
- [Thông tin kỹ thuật]`;

const VALIDATOR_PROMPT = `Bạn là một senior developer đánh giá chất lượng task description cho AI agent thực thi.

Phân tích description và trả về JSON SAU ĐÂY, không có gì khác:

{
  "overall_score": <0-100>,
  "grade": <"A" | "B" | "C" | "D" | "F">,
  "dimensions": {
    "specificity": {
      "score": <0-100>,
      "issues": ["vấn đề cụ thể 1", "vấn đề cụ thể 2"]
    },
    "completeness": {
      "score": <0-100>,
      "missing": ["thứ còn thiếu 1", "thứ còn thiếu 2"]
    },
    "testability": {
      "score": <0-100>,
      "vague_terms": ["từ mơ hồ 1", "từ mơ hồ 2"]
    },
    "technical_context": {
      "score": <0-100>,
      "missing": ["context kỹ thuật còn thiếu 1"]
    }
  },
  "vague_phrases": [
    {
      "phrase": "câu/từ mơ hồ trong description",
      "why_vague": "lý do mơ hồ",
      "better_version": "cách viết cụ thể hơn"
    }
  ],
  "missing_scenarios": ["scenario còn thiếu 1", "scenario còn thiếu 2"],
  "ai_ready": <true | false>,
  "recommendation": "lời khuyên tổng thể ngắn gọn"
}

Thang điểm grade:
A (90-100): AI có thể implement ngay, kết quả chuẩn xác
B (75-89):  AI implement được, cần review kỹ output
C (60-74):  AI sẽ phải đoán một số chỗ, kết quả có thể lệch
D (40-59):  AI sẽ đoán nhiều, cần làm rõ trước
F (0-39):   Không nên giao AI, phải viết lại description`;

// ── Tool registration ──────────────────────────

export function registerGwtTools(server: McpServer) {

server.tool(
    "generate_gwt_description",
    "Trả về description hiện tại và hướng dẫn để Claude tự sinh GWT chuẩn. " +
    "Không gọi external API — Claude đang chat sẽ tự gen Given/When/Then " +
    "từ mô tả hiện có và context nghiệp vụ.",
    {
      issueKey: z.string(),
      currentSummary: z.string(),
      currentDescription: z.string(),
      additionalContext: z.string().optional(),
      featureType: z.enum(["form","list","detail","api-integration","navigation","dashboard","bug-fix","refactor","other"]).default("other"),
    },
    withErrorHandler("generate_gwt_description", async ({ issueKey, currentSummary, currentDescription, additionalContext, featureType }) => {
      return {
        content: [{
          type: "text",
          text: [
            `# ✍️ GWT Generation Request — ${issueKey}`,
            `**Summary:** ${currentSummary}`,
            `**Feature type:** ${featureType}`,
            "",
            `## Description hiện tại`,
            currentDescription || "_Không có description_",
            additionalContext ? `\n## Additional context\n${additionalContext}` : "",
            "",
            `---`,
            `Hãy sinh description chuẩn GWT cho task trên theo format:`,
            "",
            `## Mục tiêu nghiệp vụ`,
            `[1 câu WHY]`,
            "",
            `## Acceptance Criteria`,
            `### Scenario 1: [Happy path]`,
            `**Given** ...`,
            `**When**  ...`,
            `**Then**  ...`,
            "",
            `### Scenario 2: [Error case]`,
            `...`,
            "",
            `### Scenario 3: [Edge case]`,
            `...`,
            "",
            `## Technical Notes`,
            `- [File/module cần sửa]`,
            `- [Pattern cần follow]`,
            `- [API endpoint]`,
          ].filter(s => s !== undefined).join("\n") + getChainHint("generate_gwt_description"),
        }],
      };
    })
  );
 
  server.tool(
    "validate_description_quality",
    "Trả về description để Claude tự chấm điểm chất lượng. " +
    "Claude sẽ đánh giá: specificity, completeness, testability, technical context " +
    "và trả về grade A-F cùng với các từ/câu còn mơ hồ cần sửa.",
    {
      issueKey: z.string(),
      description: z.string(),
    },
    withErrorHandler("validate_description_quality", async ({ issueKey, description }) => {
      const scenarioCount = (description.match(/^### Scenario/gm) ?? []).length;
      const checklistCount = (description.match(/^- \[[ x]\]/gm) ?? []).length;
      const hasSections = (key: string) => new RegExp(`^## \\[${key}\\]`, "m").test(description);
 
      return {
        content: [{
          type: "text",
          text: [
            `# 📋 Description Quality Check — ${issueKey}`,
            "",
            `## Signals nhanh`,
            `- Sections: WHY(${hasSections("WHY")?"✅":"❌"}) WHAT(${hasSections("WHAT")?"✅":"❌"}) WHERE(${hasSections("WHERE")?"✅":"❌"}) HOW(${hasSections("HOW")?"✅":"❌"})`,
            `- Scenarios: ${scenarioCount} | Checklist: ${checklistCount} items`,
            "",
            `## Description đầy đủ`,
            description || "_Trống_",
            "",
            `---`,
            `Hãy đánh giá description trên theo 4 tiêu chí:`,
            `1. **Specificity** (0-100) — mức độ cụ thể`,
            `2. **Completeness** (0-100) — đầy đủ thông tin`,
            `3. **Testability** (0-100) — có thể test được không`,
            `4. **Technical context** (0-100) — context kỹ thuật đủ chưa`,
            "",
            `Trả về:`,
            `- **Grade** A/B/C/D/F và overall score`,
            `- **ai_ready**: true/false`,
            `- Từ/câu mơ hồ cụ thể cần sửa`,
            `- Scenarios còn thiếu`,
            `- Recommendation`,
          ].join("\n") + getChainHint("validate_description_quality"),
        }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Types & Formatter
// ─────────────────────────────────────────────

interface ValidationResult {
  overall_score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: {
    specificity: { score: number; issues: string[] };
    completeness: { score: number; missing: string[] };
    testability: { score: number; vague_terms: string[] };
    technical_context: { score: number; missing: string[] };
  };
  vague_phrases: Array<{
    phrase: string;
    why_vague: string;
    better_version: string;
  }>;
  missing_scenarios: string[];
  ai_ready: boolean;
  recommendation: string;
}

function formatValidation(issueKey: string, r: ValidationResult): string {
  const bar = (score: number, len = 8) =>
    "█".repeat(Math.round((score / 100) * len)) + "░".repeat(len - Math.round((score / 100) * len));

  const gradeEmoji: Record<string, string> = {
    A: "🟢", B: "🔵", C: "🟡", D: "🟠", F: "🔴",
  };

  const aiReadyBanner = r.ai_ready
    ? "✅ AI READY — Có thể giao AI implement"
    : "❌ NOT READY — Cần cải thiện description trước";

  const lines: string[] = [
    `# 📋 Đánh giá description: ${issueKey}`,
    "",
    `## ${gradeEmoji[r.grade]} Grade: ${r.grade}  (${r.overall_score}/100)`,
    "",
    aiReadyBanner,
    "",
    "## Chi tiết",
    `- Độ cụ thể:          ${bar(r.dimensions.specificity.score)}  ${r.dimensions.specificity.score}%`,
    `- Độ đầy đủ:          ${bar(r.dimensions.completeness.score)}  ${r.dimensions.completeness.score}%`,
    `- Khả năng test:      ${bar(r.dimensions.testability.score)}  ${r.dimensions.testability.score}%`,
    `- Context kỹ thuật:   ${bar(r.dimensions.technical_context.score)}  ${r.dimensions.technical_context.score}%`,
    "",
  ];

  // Từ/câu mơ hồ — quan trọng nhất
  if (r.vague_phrases.length > 0) {
    lines.push("## 🔍 Từ/câu mơ hồ cần sửa");
    for (const vp of r.vague_phrases) {
      lines.push(
        `\n### ❌ "${vp.phrase}"`,
        `**Tại sao mơ hồ:** ${vp.why_vague}`,
        `**Sửa thành:** ${vp.better_version}`
      );
    }
    lines.push("");
  }

  // Scenarios còn thiếu
  if (r.missing_scenarios.length > 0) {
    lines.push("## ⬜ Scenarios còn thiếu");
    r.missing_scenarios.forEach((s) => lines.push(`  - ${s}`));
    lines.push("");
  }

  // Thứ còn thiếu
  const allMissing = [
    ...r.dimensions.completeness.missing,
    ...r.dimensions.technical_context.missing,
  ];
  if (allMissing.length > 0) {
    lines.push("## ❓ Thông tin còn thiếu");
    allMissing.forEach((m) => lines.push(`  - ${m}`));
    lines.push("");
  }

  // Recommendation
  lines.push(
    "## 💡 Khuyến nghị",
    r.recommendation,
    "",
    "---",
  );

  // Action items
  if (!r.ai_ready) {
    lines.push(
      "**Bước tiếp theo:**",
      "1. Dùng `generate_gwt_description` để AI tự sinh lại description chuẩn",
      "2. Hoặc tự sửa theo các điểm trên rồi validate lại",
    );
  } else {
    lines.push(
      "**Bước tiếp theo:**",
      "1. Dùng `detect_files_from_task` để tìm file liên quan",
      "2. Dùng `evaluate_task_complexity` để ước tính effort",
      "3. Bắt đầu implement!",
    );
  }

  return lines.join("\n");
}