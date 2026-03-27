import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Feedback Loop — Bổ sung #5
//
// Vấn đề: Sau 100 task, AI vẫn mắc cùng lỗi
// như task đầu tiên vì không có gì được capture.
//
// Giải pháp: Mỗi task hoàn thành → ghi lại
// feedback → lần sau AI đọc lịch sử → không
// lặp lại lỗi cũ.
//
// 3 tools:
//   1. submit_task_feedback  → ghi feedback sau task
//   2. get_feedback_insights → AI đọc trước khi làm task mới
//   3. list_feedback_history → xem lịch sử, tìm patterns
//
// Storage: feedback-store.json (local, không cần DB)
// ─────────────────────────────────────────────

// ── Types ─────────────────────────────────────

interface TaskFeedback {
  id: string;                    // UUID ngắn
  issueKey: string;
  summary: string;
  submittedAt: string;           // ISO date
  completedAt: string;           // ISO date

  // Đánh giá chất lượng
  codeQuality: 1 | 2 | 3 | 4 | 5;        // 1=tệ, 5=xuất sắc
  descriptionQuality: 1 | 2 | 3 | 4 | 5;
  contextAccuracy: 1 | 2 | 3 | 4 | 5;    // Context đưa cho AI có đúng không

  // Thời gian
  estimatedHours: number;        // AI ước tính
  actualHours: number;           // Thực tế

  // Những gì AI làm đúng
  whatWorked: string[];

  // Những gì AI làm sai / cần sửa
  whatFailed: string[];

  // File context nào thực sự hữu ích
  usefulContextFiles: string[];

  // File context nào không liên quan (noise)
  noiseContextFiles: string[];

  // Tribal knowledge mới phát hiện
  newTribalKnowledge: string[];

  // Tag để group feedback
  tags: string[];                // VD: ["auth", "form", "api-call"]

  // Ghi chú tự do
  notes: string;
}

interface FeedbackStore {
  version: string;
  lastUpdated: string;
  totalTasks: number;
  feedbacks: TaskFeedback[];
}

// ── System prompt cho insights ────────────────
const INSIGHTS_PROMPT = `Bạn là một senior developer phân tích lịch sử feedback để rút ra bài học.

Dựa trên feedback từ các task đã làm, trả về JSON sau:
{
  "patterns": [
    {
      "type": "recurring_mistake" | "recurring_success" | "estimation_bias" | "context_pattern",
      "description": "mô tả pattern",
      "frequency": <số lần xuất hiện>,
      "recommendation": "cách áp dụng/tránh cho task mới"
    }
  ],
  "estimation_bias": {
    "average_ratio": <actual/estimated trung bình, VD 1.3 nghĩa là thường sai 30%>,
    "recommendation": "nên nhân ước tính với X"
  },
  "best_context_files": ["file pattern hay hữu ích nhất"],
  "noise_context_files": ["file pattern hay gây noise"],
  "new_tribal_knowledge": ["tribal knowledge được phát hiện nhiều lần"],
  "task_type_performance": {
    "best_at": ["loại task AI làm tốt nhất"],
    "worst_at": ["loại task AI hay sai nhất"]
  },
  "actionable_advice": "lời khuyên cụ thể nhất cho task sắp làm"
}`;

// ── Helpers ────────────────────────────────────

async function getStorePath(): Promise<string> {
  const candidates = [
    process.env.FEEDBACK_STORE_PATH,
    path.join(process.cwd(), "feedback-store.json"),
    path.join(process.cwd(), "..", "feedback-store.json"),
  ].filter(Boolean) as string[];

  // Trả về path đầu tiên tồn tại, hoặc default path
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch { /* không tồn tại */ }
  }

  return candidates[candidates.length - 1]; // default: cwd
}

async function loadStore(): Promise<FeedbackStore> {
  const storePath = await getStorePath();
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    // File chưa tồn tại → tạo mới
    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      totalTasks: 0,
      feedbacks: [],
    };
  }
}

async function saveStore(store: FeedbackStore): Promise<void> {
  const storePath = await getStorePath();
  store.lastUpdated = new Date().toISOString();
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");
}

function generateId(): string {
  // Short unique ID: timestamp + random
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ── Tool registration ──────────────────────────

export function registerFeedbackTools(server: McpServer) {

  // ── TOOL 1: Submit task feedback ─────────────
  server.tool(
    "submit_task_feedback",
    "Ghi lại feedback sau khi hoàn thành một task. " +
    "Capture: chất lượng code AI generate, ước tính vs thực tế, " +
    "AI làm đúng gì / sai gì, file context nào hữu ích / gây noise, " +
    "và tribal knowledge mới phát hiện. " +
    "Nên gọi tool này sau khi merge PR để hệ thống học hỏi theo thời gian. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — hiển thị nội dung feedback cho user review trước.",
    {
      issueKey: z.string().describe("Jira issue key vừa hoàn thành"),
      summary: z.string().describe("Tiêu đề task"),

      codeQuality: z
        .number().min(1).max(5)
        .describe("Chất lượng code AI generate: 1=phải viết lại hoàn toàn, 3=dùng được sau khi sửa, 5=xuất sắc"),
      descriptionQuality: z
        .number().min(1).max(5)
        .describe("Chất lượng description Jira: 1=mơ hồ hoàn toàn, 5=cực kỳ rõ ràng"),
      contextAccuracy: z
        .number().min(1).max(5)
        .describe("Context đưa cho AI có đúng không: 1=toàn noise, 5=chính xác hoàn toàn"),

      estimatedHours: z
        .number()
        .describe("Số giờ AI ước tính (từ evaluate_task_complexity)"),
      actualHours: z
        .number()
        .describe("Số giờ thực tế đã làm"),

      whatWorked: z
        .array(z.string())
        .default([])
        .describe("Những gì AI làm đúng. VD: ['Đúng component structure', 'Handle error đầy đủ']"),
      whatFailed: z
        .array(z.string())
        .default([])
        .describe("Những gì AI làm sai / cần sửa. VD: ['Dùng localStorage thay sessionStorage', 'Quên loading state']"),

      usefulContextFiles: z
        .array(z.string())
        .default([])
        .describe("File context thực sự hữu ích. VD: ['libs/auth/auth.service.ts']"),
      noiseContextFiles: z
        .array(z.string())
        .default([])
        .describe("File context không liên quan, gây nhiễu. VD: ['apps/portal/app.module.ts']"),

      newTribalKnowledge: z
        .array(z.string())
        .default([])
        .describe("Tribal knowledge mới phát hiện. VD: ['UserService phải gọi qua UserFacadeService']"),

      tags: z
        .array(z.string())
        .default([])
        .describe("Tags để group feedback. VD: ['auth', 'form', 'api-call', 'bug-fix']"),
      notes: z
        .string()
        .default("")
        .describe("Ghi chú tự do — bất kỳ điều gì đáng nhớ về task này"),
    },
    withErrorHandler("submit_task_feedback", async ({
      issueKey, summary,
      codeQuality, descriptionQuality, contextAccuracy,
      estimatedHours, actualHours,
      whatWorked, whatFailed,
      usefulContextFiles, noiseContextFiles,
      newTribalKnowledge, tags, notes,
    }) => {
      const store = await loadStore();

      const feedback: TaskFeedback = {
        id: generateId(),
        issueKey,
        summary,
        submittedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        codeQuality: codeQuality as 1|2|3|4|5,
        descriptionQuality: descriptionQuality as 1|2|3|4|5,
        contextAccuracy: contextAccuracy as 1|2|3|4|5,
        estimatedHours,
        actualHours,
        whatWorked,
        whatFailed,
        usefulContextFiles,
        noiseContextFiles,
        newTribalKnowledge,
        tags,
        notes,
      };

      store.feedbacks.push(feedback);
      store.totalTasks += 1;
      await saveStore(store);

      // Tự động suggest update TEAM_CONTEXT nếu có tribal knowledge mới
      const tribalSuggestion = newTribalKnowledge.length > 0
        ? [
            "",
            "## 💡 Tribal knowledge mới — nên thêm vào TEAM_CONTEXT.md",
            ...newTribalKnowledge.map((k) => `- ${k}`),
            "",
            "Dùng `update_team_context` để lưu vào TEAM_CONTEXT.md ngay!",
          ].join("\n")
        : "";

      // Tính accuracy ước tính
      const estimationRatio = actualHours / estimatedHours;
      const estimationNote =
        estimationRatio > 1.3 ? `⚠️ Thực tế lâu hơn ${Math.round((estimationRatio - 1) * 100)}% so với ước tính` :
        estimationRatio < 0.7 ? `✅ Thực tế nhanh hơn ${Math.round((1 - estimationRatio) * 100)}% so với ước tính` :
        "✅ Ước tính khá chính xác";

      return {
        content: [{
          type: "text",
          text: [
            `# ✅ Feedback đã lưu — ${issueKey}`,
            `**ID:** ${feedback.id}`,
            `**Tổng tasks đã feedback:** ${store.totalTasks}`,
            "",
            "## Tóm tắt",
            `- Code quality:       ${"⭐".repeat(codeQuality)}  (${codeQuality}/5)`,
            `- Description:        ${"⭐".repeat(descriptionQuality)}  (${descriptionQuality}/5)`,
            `- Context accuracy:   ${"⭐".repeat(contextAccuracy)}  (${contextAccuracy}/5)`,
            "",
            `## Ước tính vs Thực tế`,
            `- Ước tính: ${estimatedHours}h → Thực tế: ${actualHours}h`,
            estimationNote,
            tribalSuggestion,
            "",
            "---",
            `💾 Đã lưu vào feedback-store.json`,
            `📈 Sau ${Math.max(5, 10 - store.totalTasks)} tasks nữa, chạy \`get_feedback_insights\` để xem patterns.`,
          ].join("\n") + getChainHint("submit_task_feedback"),
        }],
      };
    })
  );

  // ── TOOL 2: Get feedback insights ────────────
  server.tool(
    "get_feedback_insights",
    "Phân tích toàn bộ lịch sử feedback để rút ra bài học và patterns. " +
    "Trả về: lỗi lặp đi lặp lại, task type AI làm tốt/kém, " +
    "ước tính bias, file context nào thường hữu ích, " +
    "và lời khuyên cụ thể cho task sắp làm. " +
    "Dùng TRƯỚC KHI bắt đầu task mới để AI không lặp lại lỗi cũ.",
    {
      taskType: z
        .string()
        .optional()
        .describe("Loại task sắp làm để filter insights liên quan. VD: 'form', 'auth', 'api-call'"),
      lastNTasks: z
        .number()
        .default(20)
        .describe("Phân tích N task gần nhất. Default: 20"),
    },
    withErrorHandler("get_feedback_insights", async ({ taskType, lastNTasks }) => {
      const store = await loadStore();

      if (store.feedbacks.length === 0) {
        return {
          content: [{
            type: "text",
            text: [
              "## 📊 Chưa có feedback nào",
              "",
              "Sau khi hoàn thành task đầu tiên, dùng `submit_task_feedback` để bắt đầu track.",
              "Hệ thống sẽ học hỏi và cải thiện theo thời gian.",
            ].join("\n"),
          }],
        };
      }

      // Filter và lấy N tasks gần nhất
      let relevant = [...store.feedbacks]
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

      if (taskType) {
        const filtered = relevant.filter((f) =>
          f.tags.some((t) => t.toLowerCase().includes(taskType.toLowerCase())) ||
          f.summary.toLowerCase().includes(taskType.toLowerCase())
        );
        // Nếu filter ra ít hơn 3 → fallback về tất cả
        relevant = filtered.length >= 3 ? filtered : relevant;
      }

      relevant = relevant.slice(0, lastNTasks);

      // ── Quick stats trước khi gọi AI ──────────
      const avgCodeQuality = average(relevant.map((f) => f.codeQuality));
      const avgDescQuality = average(relevant.map((f) => f.descriptionQuality));
      const avgEstRatio    = average(
        relevant.map((f) => f.actualHours / f.estimatedHours).filter(isFinite)
      );

      // Collect all failures và successes
      const allFailures = relevant.flatMap((f) => f.whatFailed);
      const allSuccesses = relevant.flatMap((f) => f.whatWorked);
      const allTribal    = relevant.flatMap((f) => f.newTribalKnowledge);
      const allUseful    = relevant.flatMap((f) => f.usefulContextFiles);
      const allNoise     = relevant.flatMap((f) => f.noiseContextFiles);

      // Format feedback data
      const feedbackSummary = relevant.map((f) => ({
        issue: f.issueKey,
        tags: f.tags,
        codeQuality: f.codeQuality,
        estimationRatio: (f.actualHours / f.estimatedHours).toFixed(2),
        whatFailed: f.whatFailed,
        whatWorked: f.whatWorked,
        usefulFiles: f.usefulContextFiles,
        noiseFiles: f.noiseContextFiles,
      }));

      // Helper: đếm tần suất xuất hiện
      const countFrequency = (items: string[]): [string, number][] => {
        const map = new Map<string, number>();
        for (const item of items) {
          map.set(item, (map.get(item) ?? 0) + 1);
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
      };

      return {
        content: [{
          type: "text",
          text: [
            "# 📊 Feedback Insights — Yêu cầu phân tích",
            "",
            "## Quick Stats",
            `- Tasks analyzed: **${relevant.length}**`,
            `- Avg code quality: **${avgCodeQuality.toFixed(1)}/5**`,
            `- Avg description quality: **${avgDescQuality.toFixed(1)}/5**`,
            `- Avg estimation ratio (actual/estimated): **${avgEstRatio.toFixed(2)}**`,
            taskType ? `- Filter: task type = \`${taskType}\`` : "",
            "",
            "## Top Failures",
            ...countFrequency(allFailures).slice(0, 5).map(([item, count]) => `- ❌ ${item} (${count}x)`),
            "",
            "## Top Successes",
            ...countFrequency(allSuccesses).slice(0, 5).map(([item, count]) => `- ✅ ${item} (${count}x)`),
            "",
            "## Useful Context Files",
            ...countFrequency(allUseful).slice(0, 5).map(([item, count]) => `- 📁 ${item} (${count}x)`),
            "",
            "## Noise Context Files",
            ...countFrequency(allNoise).slice(0, 5).map(([item, count]) => `- 🚫 ${item} (${count}x)`),
            "",
            "## Tribal Knowledge",
            ...allTribal.map((t) => `- 💡 ${t}`),
            "",
            "## [SYSTEM_INSTRUCTION]",
            INSIGHTS_PROMPT,
            "",
            "## [DATA]",
            "```json",
            JSON.stringify(feedbackSummary, null, 2),
            "```",
            "",
            "⚠️ Hãy phân tích data trên, trả về insights dưới dạng markdown dễ đọc:",
            "- Patterns lặp lại (lỗi + thành công)",
            "- Estimation bias và khuyến nghị",
            "- File context hữu ích vs noise",
            "- Lời khuyên cụ thể cho task tiếp theo",
          ].filter(Boolean).join("\n") + getChainHint("get_feedback_insights"),
        }],
      };
    })
  );

  // ── TOOL 3: List feedback history ────────────
  server.tool(
    "list_feedback_history",
    "Xem danh sách lịch sử feedback các task đã làm. " +
    "Lọc theo issue key, tag, hoặc khoảng thời gian. " +
    "Dùng để tìm task tương tự đã làm trước đây hoặc review performance theo thời gian.",
    {
      filterTag: z.string().optional().describe("Filter theo tag. VD: 'auth'"),
      filterIssueKey: z.string().optional().describe("Tìm issue key cụ thể"),
      lastNDays: z.number().optional().describe("Chỉ hiển thị N ngày gần nhất"),
      showDetails: z.boolean().default(false).describe("Hiện chi tiết từng task hay chỉ summary"),
    },
    withErrorHandler("list_feedback_history", async ({ filterTag, filterIssueKey, lastNDays, showDetails }) => {
      const store = await loadStore();

      let feedbacks = [...store.feedbacks].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );

      // Apply filters
      if (filterIssueKey) {
        feedbacks = feedbacks.filter((f) =>
          f.issueKey.toLowerCase().includes(filterIssueKey.toLowerCase())
        );
      }
      if (filterTag) {
        feedbacks = feedbacks.filter((f) =>
          f.tags.some((t) => t.toLowerCase().includes(filterTag.toLowerCase()))
        );
      }
      if (lastNDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - lastNDays);
        feedbacks = feedbacks.filter((f) => new Date(f.submittedAt) > cutoff);
      }

      if (feedbacks.length === 0) {
        return {
          content: [{ type: "text", text: "Không tìm thấy feedback nào phù hợp với filter." }],
        };
      }

      const lines = [
        `# 📚 Feedback History (${feedbacks.length} tasks)`,
        "",
      ];

      for (const f of feedbacks) {
        const date = new Date(f.submittedAt).toLocaleDateString("vi-VN");
        const ratio = (f.actualHours / f.estimatedHours).toFixed(1);
        const qualityBar = "⭐".repeat(f.codeQuality);

        lines.push(`## [${f.issueKey}] ${f.summary}`);
        lines.push(`${date} | Code: ${qualityBar} | Ước tính: ${f.estimatedHours}h → Thực: ${f.actualHours}h (×${ratio}) | Tags: ${f.tags.join(", ") || "none"}`);

        if (showDetails) {
          if (f.whatFailed.length > 0) {
            lines.push(`**AI sai:** ${f.whatFailed.join("; ")}`);
          }
          if (f.whatWorked.length > 0) {
            lines.push(`**AI đúng:** ${f.whatWorked.join("; ")}`);
          }
          if (f.notes) {
            lines.push(`**Notes:** ${f.notes}`);
          }
        }
        lines.push("");
      }

      // Summary stats
      const avgQuality = average(feedbacks.map((f) => f.codeQuality));
      const avgRatio = average(feedbacks.map((f) => f.actualHours / f.estimatedHours).filter(isFinite));

      lines.push(
        "---",
        `**Avg code quality:** ${avgQuality.toFixed(1)}/5`,
        `**Avg estimation ratio:** ×${avgRatio.toFixed(2)} (1.0 = chính xác)`
      );

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("list_feedback_history") }],
      };
    })
  );
}

// (InsightsResult + formatInsights removed — no longer used after API removal)

// Utils
function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}