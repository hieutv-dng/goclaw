import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CodebaseReader } from "./reader.js";
import { SmartScorer } from "./scorer.js";
import path from "path";
import { resolveStackProfile, type StackName } from "../stack-profiles/index.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ── Stack enum cho tool params ────────────────
const STACK_ENUM = z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
  .default("auto")
  .describe("Tech stack. 'auto' = tự detect từ project root. Hoặc chỉ định: angular, spring, nestjs, flutter, react, generic");

// ─────────────────────────────────────────────
// registerCodebaseTools
//
// 5 tools đọc/tìm file trong codebase:
//   1. find_by_name     → tìm theo tên class/component/function
//   2. search_keyword   → tìm theo keyword trong nội dung file
//   3. read_module      → đọc toàn bộ 1 module/folder
//   4. detect_files     → tự động detect file liên quan từ Jira task
//   5. rank_context     → AI re-rank file theo semantic relevance
//
// Multi-framework: Hỗ trợ Angular, Spring, NestJS,
// Flutter, React thông qua StackProfile system.
// ─────────────────────────────────────────────
export function registerCodebaseTools(server: McpServer) {
  const reader = new CodebaseReader();

  // ── TOOL 1: Tìm file theo tên class/component/function ──
  server.tool(
    "find_by_name",
    "Tìm các file theo tên class, component, service, pipe, directive hoặc function. " +
    "Ví dụ: tìm 'UserProfileComponent' sẽ ra file user-profile.component.ts. " +
    "Dùng khi biết tên cụ thể của thứ cần sửa.",
    {
      name: z.string().describe("Tên class/component/service/function cần tìm. VD: 'UserProfileComponent', 'AuthService', 'formatDate'"),
      projectRoot: z.string().describe("Đường dẫn tuyệt đối đến thư mục gốc của monorepo. VD: 'D:/projects/my-app'"),
      includeContent: z.boolean().default(true).describe("Có đọc nội dung file luôn không, hay chỉ trả về đường dẫn"),
      stack: STACK_ENUM,
    },
    withErrorHandler("find_by_name", async ({ name, projectRoot, includeContent, stack }) => {
      const profile = await resolveStackProfile(stack, projectRoot);
      reader.setProfile(profile);
      const results = await reader.findByName(name, projectRoot, includeContent);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `❌ Không tìm thấy file nào chứa "${name}" trong ${projectRoot}` + getChainHint("find_by_name") }],
        };
      }

      const output = results.map((r) =>
        includeContent
          ? `### 📄 ${r.relativePath}\n\`\`\`${r.language}\n${r.content}\n\`\`\``
          : `- ${r.relativePath}`
      ).join("\n\n");

      return {
        content: [{
          type: "text",
          text: `# Kết quả tìm kiếm: "${name}" (${results.length} file)\n\n${output}` + getChainHint("find_by_name"),
        }],
      };
    })
  );

  // ── TOOL 2: Tìm file theo keyword ───────────────────────
  server.tool(
    "search_keyword",
    "Tìm kiếm toàn bộ codebase theo một keyword bất kỳ trong nội dung file. " +
    "Ví dụ: tìm 'getUserProfile' sẽ ra tất cả file có gọi function đó. " +
    "Dùng khi muốn biết keyword này xuất hiện ở đâu trong codebase.",
    {
      keyword: z.string().describe("Keyword cần tìm trong nội dung file. VD: 'getUserProfile', 'api/users', 'HttpClient'"),
      projectRoot: z.string().describe("Đường dẫn tuyệt đối đến thư mục gốc monorepo"),
      fileExtensions: z
        .array(z.string())
        .default([".ts", ".html", ".scss", ".json"])
        .describe("Các loại file cần tìm. Mặc định hỗ trợ Angular. Tự động điều chỉnh theo stack nếu dùng auto."),
      maxResults: z.number().default(10).describe("Số file tối đa trả về"),
      showContext: z.boolean().default(true).describe("Hiển thị 3 dòng xung quanh mỗi match"),
      stack: STACK_ENUM,
    },
    withErrorHandler("search_keyword", async ({ keyword, projectRoot, fileExtensions, maxResults, showContext, stack }) => {
      const profile = await resolveStackProfile(stack, projectRoot);
      reader.setProfile(profile);
      // Nếu user không chỉ định extensions → dùng từ profile
      const extensions = fileExtensions.length > 0 ? fileExtensions : [...profile.extensions, ".json"];
      const results = await reader.searchKeyword(keyword, projectRoot, extensions, maxResults, showContext);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `❌ Không tìm thấy keyword "${keyword}" trong codebase` + getChainHint("search_keyword") }],
        };
      }

      const output = results.map((r) => {
        const matches = r.matches.map((m) =>
          showContext
            ? `  Line ${m.lineNumber}:\n${m.context}`
            : `  Line ${m.lineNumber}: ${m.line}`
        ).join("\n");
        return `### 📄 ${r.relativePath} (${r.matches.length} match)\n${matches}`;
      }).join("\n\n");

      return {
        content: [{
          type: "text",
          text: `# Tìm kiếm: "${keyword}" — ${results.length} file có kết quả\n\n${output}` + getChainHint("search_keyword"),
        }],
      };
    })
  );

  // ── TOOL 3: Đọc toàn bộ 1 module/folder ────────────────
  server.tool(
    "read_module",
    "Đọc toàn bộ nội dung của một module hoặc folder. " +
    "Trả về tất cả file code trong folder đó (extensions tùy theo stack). " +
    "Dùng khi cần hiểu toàn bộ một feature/module trước khi implement.",
    {
      modulePath: z.string().describe("Đường dẫn đến folder module cần đọc. VD: 'D:/projects/my-app/src/app/features/user'"),
      includeHtml: z.boolean().default(true).describe("Đọc cả file template (.html, .xml...)"),
      includeScss: z.boolean().default(false).describe("Đọc cả file styles (.scss, .css...)"),
      maxFileSizeKb: z.number().default(50).describe("Bỏ qua file lớn hơn X KB"),
      stack: STACK_ENUM,
    },
    withErrorHandler("read_module", async ({ modulePath, includeHtml, includeScss, maxFileSizeKb, stack }) => {
      // readModule không có projectRoot → dùng modulePath parent để detect
      const profile = await resolveStackProfile(stack, path.dirname(modulePath));
      reader.setProfile(profile);
      const result = await reader.readModule(modulePath, { includeHtml, includeScss, maxFileSizeKb });

      if (result.files.length === 0) {
        return {
          content: [{ type: "text", text: `❌ Không tìm thấy file nào trong: ${modulePath}` + getChainHint("read_module") }],
        };
      }

      // Tạo overview cấu trúc module
      const structure = result.files.map((f) => `  ${f.relativePath}`).join("\n");
      const fileContents = result.files.map((f) =>
        `### 📄 ${f.relativePath}\n\`\`\`${f.language}\n${f.content}\n\`\`\``
      ).join("\n\n");

      return {
        content: [{
          type: "text",
          text: [
            `# Module: ${modulePath}`,
            `**${result.files.length} files** | **${result.totalSizeKb}KB tổng**`,
            "",
            "## 📁 Cấu trúc",
            "```",
            structure,
            "```",
            "",
            "## 📋 Nội dung",
            fileContents,
          ].join("\n") + getChainHint("read_module"),
        }],
      };
    })
  );

  // ── TOOL 4: Tự động detect file từ Jira task ────────────
  server.tool(
    "detect_files_from_task",
    "Phân tích mô tả Jira task và tự động detect những file nào cần đọc/sửa. " +
    "AI sẽ trích xuất keywords từ task, tìm file liên quan, và trả về context đầy đủ để implement. " +
    "Đây là tool thông minh nhất — dùng ngay sau khi đọc chi tiết 1 Jira task.",
    {
      issueKey: z.string().describe("Jira issue key. VD: 'VNPTAI-123'"),
      taskSummary: z.string().describe("Tiêu đề task từ Jira"),
      taskDescription: z.string().describe("Mô tả đầy đủ task từ Jira"),
      projectRoot: z.string().describe("Đường dẫn tuyệt đối đến thư mục gốc monorepo"),
      appsFolder: z.string().default("apps").describe("Tên folder chứa các app trong monorepo. Mặc định: 'apps'"),
      libsFolder: z.string().default("libs").describe("Tên folder chứa shared libs. Mặc định: 'libs'"),
      stack: STACK_ENUM,
    },
    withErrorHandler("detect_files_from_task", async ({ issueKey, taskSummary, taskDescription, projectRoot, appsFolder, libsFolder, stack }) => {
      // Bước 0: Resolve stack profile
      const profile = await resolveStackProfile(stack, projectRoot);
      reader.setProfile(profile);

      // Bước 1: Trích xuất keywords từ task description
      const keywords = extractKeywordsFromTask(taskSummary, taskDescription);

      // Bước 2: Tìm file liên quan cho mỗi keyword
      const fileMap = new Map<string, {
        relativePath: string; absolutePath: string;
        content: string; language: string; sizeKb: number;
        matchedKeywords: string[];
      }>();

      for (const keyword of keywords) {
        const found = await reader.findByName(keyword, projectRoot, true);
        for (const f of found) {
          const existing = fileMap.get(f.relativePath);
          if (existing) {
            existing.matchedKeywords.push(keyword);
          } else {
            fileMap.set(f.relativePath, {
              ...f,
              matchedKeywords: [keyword],
            });
          }
        }
      }

      // Bước 3: Dùng SmartScorer để ranking đa tín hiệu
      const scorer = new SmartScorer(profile);
      const taskText = `${taskSummary} ${taskDescription}`;

      // Build keyword map cho scorer
      const matchedKeywordsMap = new Map<string, string[]>();
      for (const [relPath, file] of fileMap) {
        matchedKeywordsMap.set(relPath, file.matchedKeywords);
      }

      const scoredFiles = await scorer.scoreFiles(
        Array.from(fileMap.values()),
        matchedKeywordsMap,
        taskText,
      );

      // Lấy top 8 file
      const topFiles = scoredFiles.slice(0, 8);

      // Bước 4: Đọc thêm cấu trúc monorepo
      const monoStructure = await reader.getMonorepoStructure(projectRoot, appsFolder, libsFolder);

      if (topFiles.length === 0) {
        return {
          content: [{
            type: "text",
            text: [
              `# 🔍 Phân tích task ${issueKey}`,
              "",
              `**Keywords đã trích xuất:** ${keywords.join(", ")}`,
              "",
              "❌ Không tìm thấy file liên quan. Có thể đây là **feature mới** cần tạo file từ đầu.",
              "",
              "## 📁 Cấu trúc Monorepo hiện tại",
              "```",
              monoStructure,
              "```",
              "",
              "## 💡 Gợi ý",
              "Dựa vào cấu trúc trên, hãy cho tôi biết bạn muốn tạo feature mới ở thư mục nào?",
            ].join("\n") + getChainHint("detect_files_from_task"),
          }],
        };
      }

      // Bước 5: Format output với score breakdown
      const fileContents = topFiles.map((f) => {
        const lang = profile.langMap[path.extname(f.relativePath)] ?? "text";
        const scoreBar = "█".repeat(Math.round(f.totalScore / 10)) + "░".repeat(10 - Math.round(f.totalScore / 10));
        const signalList = f.signals.length > 0
          ? f.signals.map(s => `>   - ${s}`).join("\n")
          : ">   - Basic match";

        return [
          `### 📄 ${f.relativePath}`,
          `> Score: ${scoreBar} **${f.totalScore}** (📝${f.scoreBreakdown.keywordFrequency} | 📂${f.scoreBreakdown.fileTypePriority} | ❤️${f.scoreBreakdown.feedbackBoost} | ⏰${f.scoreBreakdown.recency} | 🔧${f.scoreBreakdown.frameworkPattern})`,
          signalList,
          `\`\`\`${lang}`,
          f.content,
          `\`\`\``,
        ].join("\n");
      }).join("\n\n");

      return {
        content: [{
          type: "text",
          text: [
            `# 🔍 Context cho task ${issueKey}: ${taskSummary}`,
            "",
            `**Keywords đã phân tích:** ${keywords.join(", ")}`,
            `**File liên quan tìm được:** ${topFiles.length} file (từ ${Array.from(fileMap.keys()).length} candidates)`,
            `**Scoring:** 📝 Keyword | 📂 FileType | ❤️ Feedback | ⏰ Recency | 🔧 ${profile.displayName} Pattern`,
            "",
            "## 📁 Cấu trúc Monorepo",
            "```",
            monoStructure,
            "```",
            "",
            "## 📋 File liên quan (sắp xếp theo độ liên quan)",
            fileContents,
            "",
            "---",
            "## 🚀 Sẵn sàng implement!",
            `Tôi đã có đủ context để implement task **${issueKey}**.`,
            "Bạn muốn tôi:",
            "1. Phân tích chi tiết và đề xuất hướng implement?",
            "2. Generate code ngay?",
            "3. Tạo sub-tasks nhỏ hơn?",
          ].join("\n") + getChainHint("detect_files_from_task"),
        }],
      };
    })
  );
   // ── TOOL 5 (mới): Rank context files ─────────
  server.tool(
    "rank_context_files",
    "Nhận một danh sách file paths và dùng AI để re-rank theo mức độ liên quan " +
    "đến task description. Dùng khi bạn đã có sẵn danh sách file muốn đưa vào context " +
    "nhưng muốn AI chọn ra đúng top-5 quan trọng nhất thay vì đọc tất cả. " +
    "Semantic ranking bằng Claude API — hiểu ngữ nghĩa thay vì chỉ đếm keyword.",
    {
      issueKey: z.string().describe("Jira issue key"),
      taskSummary: z.string().describe("Tiêu đề task"),
      taskDescription: z.string().describe("Mô tả task"),
      filePaths: z.array(z.string())
        .min(2).max(20)
        .describe("Danh sách đường dẫn file cần rank. Tối thiểu 2, tối đa 20."),
      projectRoot: z.string().describe("Đường dẫn gốc monorepo để resolve relative paths"),
      topK: z.number().min(1).max(7).default(5)
        .describe("Số file muốn giữ lại sau ranking"),
    },
    withErrorHandler("rank_context_files", async ({ issueKey, taskSummary, taskDescription, filePaths, projectRoot, topK }) => {
      // ── Đọc nội dung các file ────────────────
      const fileContents: Array<{ path: string; snippet: string }> = [];
 
      for (const fp of filePaths) {
        const absPath = path.isAbsolute(fp) ? fp : path.join(projectRoot, fp);
        try {
          const raw = await import("fs/promises").then((m) => m.readFile(absPath, "utf-8"));
          // Chỉ lấy 60 dòng đầu — đủ để AI hiểu file làm gì
          const snippet = raw.split("\n").slice(0, 60).join("\n");
          fileContents.push({ path: fp, snippet });
        } catch {
          fileContents.push({ path: fp, snippet: "[Could not read file]" });
        }
      }
 
      // ── Trả về data + prompt để model tự rank ─────
      const fileList = fileContents.map((f, i) =>
        `### [${i + 1}] \`${f.path}\`\n\`\`\`\n${f.snippet.slice(0, 300)}\n\`\`\``
      ).join("\n\n");

      return {
        content: [{
          type: "text",
          text: [
            `# 🎯 Context Files cần Rank — ${issueKey}`,
            "",
            `**Task:** ${taskSummary}`,
            `**Description:** ${taskDescription}`,
            `**Top K:** ${topK}`,
            "",
            "## [FILES_TO_RANK]",
            "",
            fileList,
            "",
            "## [INSTRUCTION]",
            `Hãy chọn **top ${topK} files** liên quan nhất đến task trên.`,
            "Với mỗi file, cho điểm relevance 0-100 và giải thích ngắn gọn.",
            "Liệt kê các file bị loại và lý do.",
            "",
            "Format output:",
            "1. `path/to/file.ts` — **Score: 95** — _Lý do liên quan_",
            "2. ...",
            "",
            "❌ Loại bỏ:",
            "- `path/to/other.ts` — _Lý do không liên quan_",
          ].join("\n") + getChainHint("rank_context_files"),
        }],
      };
    })
  );
}

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
    "Phân tích và đánh giá độ phức tạp của một Jira task. " +
    "Trả về: điểm rõ ràng, độ phức tạp, rủi ro khi giao AI, " +
    "thông tin còn thiếu, ước tính giờ làm, và subtasks gợi ý. " +
    "Dùng trước khi quyết định có nên giao task này cho AI implement hay không.",
    {
      issueKey: z.string().describe("Jira issue key. VD: 'VNPTAI-123'"),
      summary: z.string().describe("Tiêu đề task"),
      description: z.string().describe("Mô tả đầy đủ của task"),
      issueType: z.string().optional().describe("Loại issue: Task, Bug, Story..."),
      priority: z.string().optional().describe("Độ ưu tiên: High, Medium, Low..."),
    },
    withErrorHandler("evaluate_task_complexity", async ({ issueKey, summary, description, issueType, priority }) => {
      // Trả về data + prompt để model của user tự đánh giá
      return {
        content: [{
          type: "text",
          text: [
            `# 📊 Đánh giá Task Complexity — ${issueKey}`,
            "",
            "## [SYSTEM_INSTRUCTION]",
            EVALUATOR_SYSTEM_PROMPT,
            "",
            "## [TASK_DATA]",
            `- **Issue:** ${issueKey}`,
            `- **Type:** ${issueType ?? "Task"}`,
            `- **Priority:** ${priority ?? "Medium"}`,
            `- **Summary:** ${summary}`,
            "",
            "### Description",
            description,
            "",
            "## [EXPECTED_OUTPUT]",
            "Hãy phân tích task trên và trả về đánh giá theo format sau:",
            "",
            "| Tiêu chí | Score | Level | Ghi chú |",
            "|---|---|---|---|",
            "| Clarity (Rõ ràng) | /100 | | Thiếu gì? |",
            "| Complexity (Phức tạp) | /100 | | Tại sao? |",
            "| AI Risk (Rủi ro giao AI) | /100 | | Rủi ro gì? |",
            "",
            "Bổ sung thêm:",
            "- ⏱️ Ước tính giờ làm",
            "- 📋 Subtasks gợi ý",
            "- ❓ Thông tin còn thiếu",
            "- 💡 Khuyến nghị: nên giao AI hay developer tự làm?",
          ].join("\n") + getChainHint("evaluate_task_complexity"),
        }],
      };
    })
  );
}

// (EvaluationResult + formatEvaluation removed — no longer used after API removal)
// ─────────────────────────────────────────────
// extractKeywordsFromTask
//
// Trích xuất keywords có nghĩa từ task description
// để dùng làm search term tìm file liên quan.
//
// Chiến lược:
//   1. Split theo whitespace và dấu câu
//   2. Filter bỏ stopwords tiếng Việt + tiếng Anh
//   3. Giữ lại PascalCase (tên class), camelCase (function)
//   4. Deduplicate
// ─────────────────────────────────────────────
function extractKeywordsFromTask(summary: string, description: string): string[] {
  const text = `${summary} ${description}`;

  // Tìm PascalCase words → thường là tên Component, Service, Class
  const pascalCase = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];

  // Tìm camelCase words → thường là tên function, method
  const camelCase = text.match(/\b[a-z][a-zA-Z]{3,}\b/g) ?? [];

  // Tìm kebab-case → thường là tên selector, route, file path
  const kebabCase = text.match(/\b[a-z]+-[a-z-]+\b/g) ?? [];

  const STOPWORDS = new Set([
    // Tiếng Anh
    "the", "and", "for", "with", "this", "that", "from", "have", "will",
    "should", "must", "when", "then", "also", "into", "upon", "been",
    "user", "data", "list", "item", "page", "form", "view", "type",
    // Tiếng Việt phổ biến trong task description
    "thêm", "sửa", "xóa", "tạo", "hiển", "thị", "danh", "sách",
    "chức", "năng", "màn", "hình", "người", "dùng", "thông", "tin",
  ]);

  const all = [...pascalCase, ...camelCase, ...kebabCase]
    .filter((w) => !STOPWORDS.has(w.toLowerCase()))
    .filter((w) => w.length > 3);

  // Deduplicate (giữ thứ tự xuất hiện)
  return [...new Set(all)].slice(0, 15); // Tối đa 15 keywords
}