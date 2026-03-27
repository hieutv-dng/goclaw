import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Git Standard — Quy chuẩn Git cho project
//
// Mỗi project có thể cung cấp file GIT_STANDARD.md
// riêng để quy chuẩn commit message, branch naming,
// 1. PROJECT_ROOT/GIT_STANDARD.md hoặc PROJECT_ROOT/docs/GIT_STANDARD.md
// 2. Nếu không có, MCP trả về 1 nội dung string rỗng (bỏ qua convention).
// default trong docs/GIT_STANDARD.md của MCP.
//
// Tool: get_git_standard
// ─────────────────────────────────────────────

// Danh sách file tìm trong project root (ưu tiên từ trên xuống)
const PROJECT_CANDIDATES = [
  "GIT_STANDARD.md",
  "docs/GIT_STANDARD.md",
  ".docs/GIT_STANDARD.md",
  "CONTRIBUTING.md",
];

// Keywords để verify CONTRIBUTING.md có chứa git standard không
const GIT_KEYWORDS = ["commit", "branch", "merge", "gitflow", "conventional"];

/**
 * Tìm file git standard trong project root.
 * Trả về { path, content, source } hoặc null nếu không tìm thấy.
 */
async function findProjectGitStandard(
  projectRoot: string
): Promise<{ filePath: string; content: string; source: "project" } | null> {
  for (const candidate of PROJECT_CANDIDATES) {
    const fullPath = path.join(projectRoot, candidate);
    try {
      const content = await fs.readFile(fullPath, "utf-8");

      // Nếu là CONTRIBUTING.md → kiểm tra có chứa git-related content không
      if (candidate === "CONTRIBUTING.md") {
        const lower = content.toLowerCase();
        const hasGitContent = GIT_KEYWORDS.some((kw) => lower.includes(kw));
        if (!hasGitContent) continue; // Không phải git standard → bỏ qua
      }

      return { filePath: fullPath, content, source: "project" };
    } catch {
      // File không tồn tại → thử candidate tiếp theo
    }
  }

  return null;
}

/**
 * Đọc file default git standard từ MCP server (docs/GIT_STANDARD.md)
 */
async function getDefaultGitStandard(): Promise<{
  filePath: string;
  content: string;
  source: "mcp-default";
} | null> {
  // Resolve path tương đối từ vị trí file hiện tại
  // src/git-standard/tools.ts → ../../docs/GIT_STANDARD.md
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const isWindows = path.sep === "\\";
  
  const defaultPath = path.resolve(__dirname, "..", "..", "docs", "GIT_STANDARD.md");

  try {
    const content = await fs.readFile(defaultPath, "utf-8");
    return { filePath: defaultPath, content, source: "mcp-default" };
  } catch {
    return null;
  }
}

// ── Tool registration ──────────────────────────

export function registerGitStandardTools(server: McpServer) {
  server.tool(
    "get_git_standard",
    "Đọc quy chuẩn Git (commit message, branch naming, workflow) cho project hiện tại. " +
    "Nếu project có file GIT_STANDARD.md riêng → dùng file đó. " +
    "Nếu không có → dùng quy chuẩn mặc định của VNPT. " +
    "LUÔN gọi tool này TRƯỚC KHI tạo branch, commit, hoặc PR " +
    "để đảm bảo tuân thủ đúng quy chuẩn của project.",
    {
      projectRoot: z
        .string()
        .optional()
        .describe(
          "Đường dẫn tuyệt đối đến project root. " +
          "Nếu cung cấp → tìm GIT_STANDARD.md trong project trước. " +
          "Bỏ trống → chỉ trả về quy chuẩn mặc định."
        ),
    },
    withErrorHandler("get_git_standard", async ({ projectRoot }) => {
      let result: { filePath: string; content: string; source: string } | null = null;

      // Bước 1: Tìm trong project root (nếu có)
      if (projectRoot) {
        result = await findProjectGitStandard(projectRoot);
      }

      // Bước 2: Fallback về default MCP
      if (!result) {
        result = await getDefaultGitStandard();
      }

      // Bước 3: Không tìm thấy gì
      if (!result) {
        return {
          content: [{
            type: "text",
            text: [
              "❌ Không tìm thấy quy chuẩn Git nào.",
              "",
              "**Cách khắc phục:**",
              "1. Tạo file `GIT_STANDARD.md` trong project root, hoặc",
              "2. Tạo file `docs/GIT_STANDARD.md` trong project",
              "",
              "File nên chứa: quy tắc đặt tên branch, commit message format, và workflow.",
            ].join("\n"),
          }],
        };
      }

      // Bước 4: Format output
      const sourceLabel =
        result.source === "project"
          ? `📁 **Nguồn: Project** — \`${result.filePath}\``
          : `📦 **Nguồn: Mặc định MCP** — \`${result.filePath}\`\n> _Project chưa có GIT_STANDARD.md riêng. Tạo file này trong project root để override._`;

      return {
        content: [{
          type: "text",
          text: [
            "# 📐 Quy chuẩn Git",
            "",
            sourceLabel,
            "",
            "---",
            "",
            result.content,
          ].join("\n") + getChainHint("get_git_standard"),
        }],
      };
    })
  );

  // ── TOOL 2: Gợi ý tên branch ─────────────────
  server.tool(
    "suggest_branch_name",
    "Gợi ý tên branch theo đúng quy chuẩn Git của project. " +
    "Dựa vào Jira issue key, loại task, và mô tả để sinh tên branch chuẩn. " +
    "VD: 'feature/VNPTAI-123-add-user-profile'. " +
    "⚠️ PHẢI hiển thị gợi ý cho user chọn — không tự động tạo branch.",
    {
      issueKey: z.string().describe("Jira issue key. VD: 'VNPTAI-123'"),
      summary: z.string().describe("Tiêu đề task từ Jira"),
      issueType: z
        .enum(["feature", "fix", "docs", "refactor", "test", "chore", "hotfix"])
        .default("feature")
        .describe("Loại task: feature, fix, docs, refactor, test, chore, hotfix"),
    },
    withErrorHandler("suggest_branch_name", async ({ issueKey, summary, issueType }) => {
      const slug = toSlug(summary);
      const shortSlug = slug.split("-").slice(0, 5).join("-"); // Tối đa 5 từ
      const keyLower = issueKey.toLowerCase();

      // Prefix mapping theo loại task
      const prefixMap: Record<string, string> = {
        feature: "feature",
        fix: "fix",
        docs: "docs",
        refactor: "refactor",
        test: "test",
        chore: "chore",
        hotfix: "hotfix",
      };
      const prefix = prefixMap[issueType] ?? "feature";

      // Sinh nhiều gợi ý để user chọn
      const suggestions = [
        `${prefix}/${keyLower}-${shortSlug}`,
        `${prefix}/${shortSlug}`,
        `${prefix}/${issueKey}-${shortSlug}`,
      ];

      // Thêm variant không có issue key nếu tên ngắn
      if (slug.length <= 40) {
        suggestions.push(`${prefix}/${slug}`);
      }

      // Deduplicate
      const unique = [...new Set(suggestions)];

      return {
        content: [{
          type: "text",
          text: [
            `# 🌿 Gợi ý tên Branch`,
            "",
            `**Task:** ${issueKey} — ${summary}`,
            `**Loại:** ${issueType}`,
            "",
            "## Danh sách gợi ý",
            "",
            ...unique.map((s, i) => `${i + 1}. \`${s}\``),
            "",
            "---",
            "💡 Chọn một tên ở trên hoặc tự đặt tên theo format: `<loại>/<issue-key>-<mô-tả-ngắn>`",
            "",
            "```bash",
            `# Ví dụ tạo branch:`,
            `git checkout -b ${unique[0]}`,
            "```",
          ].join("\n") + getChainHint("suggest_branch_name"),
        }],
      };
    })
  );

  // ── TOOL 3: Gợi ý commit message ─────────────
  server.tool(
    "suggest_commit_message",
    "Gợi ý commit message theo Conventional Commits. " +
    "Dựa vào loại thay đổi, phạm vi, và mô tả để sinh commit chuẩn. " +
    "VD: 'feat(user): add login api'. " +
    "⚠️ PHẢI hiển thị gợi ý cho user chọn — không tự động commit.",
    {
      type: z
        .enum(["feat", "fix", "docs", "refactor", "test", "chore", "style", "perf", "ci", "build"])
        .describe("Loại commit: feat, fix, docs, refactor, test, chore, style, perf, ci, build"),
      scope: z
        .string()
        .optional()
        .describe("Phạm vi thay đổi (module/component). VD: 'auth', 'user', 'api'. Bỏ trống nếu không có."),
      description: z
        .string()
        .describe("Mô tả ngắn gọn những gì đã thay đổi. VD: 'add login validation', 'fix token expiration'"),
      body: z
        .string()
        .optional()
        .describe("Mô tả chi tiết hơn (optional). Sẽ nằm ở dòng thứ 2 của commit."),
      issueKey: z
        .string()
        .optional()
        .describe("Jira issue key để thêm vào footer. VD: 'VNPTAI-123'"),
      isBreaking: z
        .boolean()
        .default(false)
        .describe("Có phải breaking change không? Nếu true → thêm '!' vào commit"),
    },
    withErrorHandler("suggest_commit_message", async ({ type, scope, description, body, issueKey, isBreaking }) => {
      // Build commit message theo Conventional Commits
      const scopePart = scope ? `(${scope})` : "";
      const breakingMark = isBreaking ? "!" : "";
      const headerLine = `${type}${scopePart}${breakingMark}: ${description}`;

      // Build full commit message
      const parts = [headerLine];

      if (body) {
        parts.push("", body);
      }

      if (isBreaking) {
        parts.push("", `BREAKING CHANGE: ${description}`);
      }

      if (issueKey) {
        parts.push("", `Refs: ${issueKey}`);
      }

      const fullMessage = parts.join("\n");

      // Sinh các variant
      const variants: string[] = [headerLine];

      // Variant với scope khác nếu scope có thể rút gọn
      if (scope && scope.includes("-")) {
        const shortScope = scope.split("-")[0];
        variants.push(`${type}(${shortScope})${breakingMark}: ${description}`);
      }

      // Variant không scope
      if (scope) {
        variants.push(`${type}${breakingMark}: ${description}`);
      }

      const unique = [...new Set(variants)];

      return {
        content: [{
          type: "text",
          text: [
            `# 📝 Gợi ý Commit Message`,
            "",
            "## Conventional Commits format",
            "```",
            `<type>(<scope>): <description>`,
            "```",
            "",
            "## Gợi ý",
            "",
            ...unique.map((s, i) => `${i + 1}. \`${s}\``),
            "",
            ...(body || issueKey || isBreaking ? [
              "## Full commit message",
              "```",
              fullMessage,
              "```",
              "",
            ] : []),
            "---",
            "```bash",
            `# Quick commit:`,
            `git commit -m "${headerLine}"`,
            ...(body || issueKey ? [
              "",
              "# Hoặc với full message:",
              `git commit -m "${headerLine}" -m "${body ?? ""}" ${issueKey ? `-m "Refs: ${issueKey}"` : ""}`,
            ] : []),
            "```",
          ].join("\n") + getChainHint("suggest_commit_message"),
        }],
      };
    })
  );
}

// ─── Utility ──────────────────────────────────

/**
 * Chuyển text bất kỳ thành slug cho branch name.
 * VD: "Add User Profile Component" → "add-user-profile-component"
 *     "Sửa lỗi đăng nhập" → "sua-loi-dang-nhap"
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics (tiếng Việt)
    .replace(/đ/g, "d")             // Handle đ → d
    .replace(/[^a-z0-9\s-]/g, "")   // Remove special chars
    .replace(/\s+/g, "-")           // Spaces → hyphens
    .replace(/-+/g, "-")            // Collapse multiple hyphens
    .replace(/^-|-$/g, "")          // Trim hyphens
    .slice(0, 60);                  // Max 60 chars
}
