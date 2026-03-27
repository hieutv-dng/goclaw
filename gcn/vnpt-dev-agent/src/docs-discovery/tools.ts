import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Project Docs Discovery
//
// Tự động quét toàn bộ tài liệu .md trong dự án
// của user, thay vì chỉ hardcode 3 file cứng.
//
// Giải quyết vấn đề: Dự án đã có bộ docs riêng
// (rules, skills, workflows, architecture...)
// mà MCP cũ không biết đến.
// ─────────────────────────────────────────────

// Các thư mục thường chứa docs trong dự án
const DOC_SEARCH_DIRS = [
  ".",            // Root (README.md, CONTRIBUTING.md...)
  "docs",
  "doc",
  ".gemini",
  ".gemini/workflows",
  ".agent",
  ".agents",
  "_agents",
  "rules",
  ".cursor",
  ".cursor/rules",
  ".github",
];

// Các file pattern quan trọng (ưu tiên cao)
const PRIORITY_PATTERNS = [
  "README.md",
  "TEAM_CONTEXT.md",
  "GIT_STANDARD.md",
  "SECURITY_PATTERNS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "CODING_STANDARDS.md",
  "API_STANDARDS.md",
  "CHANGELOG.md",
];

interface DocEntry {
  relativePath: string;
  absolutePath: string;
  sizeKb: number;
  category: string;    // "context" | "workflow" | "rule" | "guide" | "other"
  priority: "high" | "medium" | "low";
}

function categorizeDoc(relativePath: string): { category: string; priority: "high" | "medium" | "low" } {
  const lower = relativePath.toLowerCase();
  const basename = path.basename(lower);

  // High priority: core context files
  if (PRIORITY_PATTERNS.some(p => basename === p.toLowerCase())) {
    return { category: "context", priority: "high" };
  }

  // Workflows
  if (lower.includes("workflow") || lower.includes(".gemini") || lower.includes(".agent")) {
    return { category: "workflow", priority: "medium" };
  }

  // Rules
  if (lower.includes("rule") || lower.includes("convention") || lower.includes("standard") || lower.includes(".cursor")) {
    return { category: "rule", priority: "medium" };
  }

  // Security
  if (lower.includes("security") || lower.includes("auth")) {
    return { category: "security", priority: "high" };
  }

  // Architecture / Design
  if (lower.includes("architect") || lower.includes("design") || lower.includes("adr")) {
    return { category: "architecture", priority: "medium" };
  }

  // Guides
  if (lower.includes("guide") || lower.includes("tutorial") || lower.includes("howto") || lower.includes("setup")) {
    return { category: "guide", priority: "low" };
  }

  return { category: "other", priority: "low" };
}

export function registerDocsDiscoveryTools(server: McpServer) {

  // ── TOOL 1: Scan Project Docs ─────────────────
  server.tool(
    "scan_project_docs",
    "Quét toàn bộ tài liệu .md trong dự án. " +
    "Tự động tìm trong docs/, .gemini/, rules/, .cursor/... " +
    "Trả về danh sách file + phân loại (context/workflow/rule/guide). " +
    "Dùng ĐẦU TIÊN trước khi implement để biết dự án có những tài liệu gì.",
    {
      projectRoot: z.string().describe("Đường dẫn tuyệt đối đến thư mục gốc dự án"),
      maxDepth: z.number().default(3).describe("Độ sâu tối đa khi quét. Default: 3"),
    },
    withErrorHandler("scan_project_docs", async ({ projectRoot, maxDepth }) => {
      const docs: DocEntry[] = [];
      const visited = new Set<string>();

      // Scan each candidate directory
      for (const dir of DOC_SEARCH_DIRS) {
        const fullDir = path.join(projectRoot, dir);
        try {
          await scanDirectory(fullDir, projectRoot, docs, visited, 0, maxDepth);
        } catch {
          // Directory doesn't exist, skip
        }
      }

      if (docs.length === 0) {
        return {
          content: [{
            type: "text",
            text: [
              "# 📭 Không tìm thấy tài liệu nào",
              "",
              `Đã quét ${DOC_SEARCH_DIRS.length} thư mục trong \`${projectRoot}\` nhưng không thấy file .md nào.`,
              "",
              "💡 **Gợi ý:** Tạo ít nhất 1 file `TEAM_CONTEXT.md` ở thư mục gốc để AI hiểu convention của team.",
            ].join("\n"),
          }],
        };
      }

      // Sort: high priority first, then by category
      docs.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      const categoryIcon: Record<string, string> = {
        context: "🧠",
        workflow: "🔄",
        rule: "📏",
        security: "🔐",
        architecture: "🏗️",
        guide: "📖",
        other: "📄",
      };

      const highPriority = docs.filter(d => d.priority === "high");
      const medPriority = docs.filter(d => d.priority === "medium");
      const lowPriority = docs.filter(d => d.priority === "low");

      const formatEntry = (d: DocEntry) =>
        `- ${categoryIcon[d.category] || "📄"} \`${d.relativePath}\` (${d.sizeKb}KB) — ${d.category}`;

      const lines = [
        `# 📚 Project Docs Discovery`,
        `**Project:** \`${projectRoot}\``,
        `**Tìm thấy:** ${docs.length} tài liệu`,
        "",
      ];

      if (highPriority.length > 0) {
        lines.push(`## 🔴 Quan trọng (nên đọc ngay)`, ...highPriority.map(formatEntry), "");
      }
      if (medPriority.length > 0) {
        lines.push(`## 🟡 Hữu ích (đọc khi cần)`, ...medPriority.map(formatEntry), "");
      }
      if (lowPriority.length > 0) {
        lines.push(`## ⚪ Tham khảo`, ...lowPriority.map(formatEntry), "");
      }

      lines.push(
        "---",
        "## 🤖 Hướng dẫn cho AI",
        "- Tự động gọi `read_project_doc` cho các file 🔴 **Quan trọng** trước khi implement.",
        "- Chỉ đọc file 🟡 khi task liên quan đến workflow/rules cụ thể.",
        "- KHÔNG cần đọc file ⚪ trừ khi user yêu cầu.",
      );

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("scan_project_docs") }],
      };
    })
  );

  // ── TOOL 2: Read Project Doc ──────────────────
  server.tool(
    "read_project_doc",
    "Đọc nội dung 1 file tài liệu bất kỳ trong dự án. " +
    "Dùng sau `scan_project_docs` để đọc chi tiết các file quan trọng. " +
    "Hỗ trợ .md, .txt, .yaml, .json.",
    {
      projectRoot: z.string().describe("Đường dẫn tuyệt đối đến thư mục gốc dự án"),
      relativePath: z.string().describe("Đường dẫn tương đối từ project root. VD: 'docs/ARCHITECTURE.md'"),
      maxLines: z.number().default(500).describe("Giới hạn số dòng đọc. Default: 500"),
    },
    withErrorHandler("read_project_doc", async ({ projectRoot, relativePath, maxLines }) => {
      const fullPath = path.join(projectRoot, relativePath);

      // Security check: don't allow path traversal
      const resolved = path.resolve(fullPath);
      const rootResolved = path.resolve(projectRoot);
      if (!resolved.startsWith(rootResolved)) {
        return {
          content: [{
            type: "text",
            text: "❌ Lỗi bảo mật: Đường dẫn file nằm ngoài thư mục dự án. Không cho phép đọc." + getChainHint("read_project_doc"),
          }],
        };
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const truncated = lines.length > maxLines;
        const displayContent = truncated ? lines.slice(0, maxLines).join("\n") : content;

        return {
          content: [{
            type: "text",
            text: [
              `# 📄 ${relativePath}`,
              `_${lines.length} dòng${truncated ? ` (hiển thị ${maxLines} dòng đầu)` : ""}_`,
              "",
              "```",
              displayContent,
              "```",
              truncated ? `\n⚠️ File bị cắt (${lines.length - maxLines} dòng còn lại). Tăng \`maxLines\` nếu cần.` : "",
            ].join("\n") + getChainHint("read_project_doc"),
          }],
        };
      } catch {
        return {
          content: [{
            type: "text",
            text: `❌ Không thể đọc file: \`${relativePath}\`. Kiểm tra lại đường dẫn.` + getChainHint("read_project_doc"),
          }],
        };
      }
    })
  );
}

// ── Helper: Recursive directory scanner ──────
async function scanDirectory(
  dirPath: string,
  projectRoot: string,
  results: DocEntry[],
  visited: Set<string>,
  depth: number,
  maxDepth: number
): Promise<void> {
  if (depth > maxDepth) return;

  const resolvedDir = path.resolve(dirPath);
  if (visited.has(resolvedDir)) return;
  visited.add(resolvedDir);

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Skip common non-doc directories
  const skipDirs = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "target", ".dart_tool"];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory() && !skipDirs.includes(entry.name)) {
      await scanDirectory(fullPath, projectRoot, results, visited, depth + 1, maxDepth);
    }

    if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
      try {
        const stat = await fs.stat(fullPath);
        const sizeKb = Math.round(stat.size / 1024);

        // Skip very large files (>200KB) and very small (<0.1KB)
        if (sizeKb > 200 || stat.size < 100) continue;

        const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
        const { category, priority } = categorizeDoc(relativePath);

        results.push({
          relativePath,
          absolutePath: fullPath,
          sizeKb,
          category,
          priority,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}
