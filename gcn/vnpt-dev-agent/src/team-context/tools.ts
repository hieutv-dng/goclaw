import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// registerTeamContextTools
//
// Mục đích: Inject tribal knowledge vào mọi
// tác vụ AI thực hiện — tránh AI làm đúng về
// mặt kỹ thuật nhưng sai về mặt context team.
//
// 2 tools:
//   1. get_team_context     → đọc toàn bộ hoặc filter theo section
//   2. update_team_context  → thêm/cập nhật một entry vào file
// ─────────────────────────────────────────────

// Danh sách sections có trong TEAM_CONTEXT.md
// Dùng để filter thông minh theo loại task
const SECTION_KEYWORDS: Record<string, string[]> = {
  SERVICE_RULES:          ["service", "inject", "provider", "facade", "repository"],
  API_GOTCHAS:            ["api", "http", "endpoint", "request", "response", "fetch", "call"],
  FORBIDDEN_PATTERNS:     ["pattern", "refactor", "style", "lint", "any", "type"],
  PREFERRED_PATTERNS:     ["implement", "code", "pattern", "rxjs", "observable", "subject"],
  NAMING_CONVENTIONS:     ["name", "create", "new", "component", "service", "pipe", "directive"],
  KNOWN_ISSUES:           ["bug", "issue", "error", "fix", "broken", "fail"],
  TEMPORARY_WORKAROUNDS:  ["refactor", "clean", "improve", "optimize", "rewrite"],
  SECURITY_RULES:         ["auth", "token", "password", "login", "permission", "role", "secure", "encrypt"],
  TESTING_RULES:          ["test", "spec", "coverage", "mock", "unit", "e2e"],
  DEPENDENCIES:           ["install", "library", "package", "import", "dependency", "npm"],
};

export function registerTeamContextTools(server: McpServer) {

  // ── TOOL 1: Đọc team context ─────────────────
  server.tool(
    "get_team_context",
    "Đọc TEAM_CONTEXT.md — file chứa tribal knowledge của team: " +
    "architecture rules, service patterns, API gotchas, forbidden patterns, " +
    "naming conventions, và những kiến thức ngầm định không có trong code. " +
    "LUÔN gọi tool này TRƯỚC KHI implement bất kỳ task nào để đảm bảo " +
    "code generate ra phù hợp với convention thực tế của team.",
    {
      taskDescription: z
        .string()
        .optional()
        .describe(
          "Mô tả task đang cần làm. Nếu cung cấp, chỉ trả về các sections " +
          "liên quan thay vì toàn bộ file — giúp giảm noise."
        ),
      sections: z
        .array(z.string())
        .optional()
        .describe(
          "Chỉ đọc các sections cụ thể. " +
          "VD: ['SERVICE_RULES', 'FORBIDDEN_PATTERNS']. " +
          "Bỏ trống = trả về tất cả."
        ),
      contextFilePath: z
        .string()
        .optional()
        .describe(
          "Đường dẫn đến TEAM_CONTEXT.md. " +
          "Mặc định: tìm trong thư mục gốc của vnpt-dev-agent."
        ),
    },
    withErrorHandler("get_team_context", async ({ taskDescription, sections, contextFilePath }) => {
      const filePath = contextFilePath ?? await findContextFile();

      if (!filePath) {
        return {
          content: [{
            type: "text",
            text: [
              "⚠️ Không tìm thấy file TEAM_CONTEXT.md!",
              "",
              "Hãy tạo file này tại thư mục gốc của project:",
              "  D:\\learn\\vnpt-dev-agent\\TEAM_CONTEXT.md",
              "",
              "File này rất quan trọng — nó chứa tribal knowledge của team",
              "để AI không generate code sai convention.",
              "",
              "Template đã được tạo sẵn trong project của bạn.",
            ].join("\n"),
          }],
        };
      }

      const content = await fs.readFile(filePath, "utf-8");
      const parsed = parseContextFile(content);

      // Xác định sections cần trả về
      let targetSections: string[];

      if (sections && sections.length > 0) {
        // Mode: lấy sections được chỉ định
        targetSections = sections;
      } else if (taskDescription) {
        // Mode: auto-detect sections liên quan đến task
        targetSections = detectRelevantSections(taskDescription);
      } else {
        // Mode: lấy tất cả
        targetSections = Object.keys(parsed.sections);
      }

      const output = buildContextOutput(parsed, targetSections, !!taskDescription);

      return {
        content: [{ type: "text", text: output + getChainHint("get_team_context") }],
      };
    })
  );

  // ── TOOL 2: Cập nhật team context ────────────
  server.tool(
    "update_team_context",
    "Thêm hoặc cập nhật một entry vào TEAM_CONTEXT.md. " +
    "Dùng khi phát hiện tribal knowledge mới trong quá trình làm việc: " +
    "API gotcha chưa được document, forbidden pattern mới, workaround tạm thời... " +
    "Giúp hệ thống liên tục học hỏi và cải thiện theo thời gian. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — hiển thị nội dung sẽ thêm cho user duyệt.",
    {
      section: z
        .enum([
          "SERVICE_RULES", "API_GOTCHAS", "FORBIDDEN_PATTERNS",
          "PREFERRED_PATTERNS", "NAMING_CONVENTIONS", "KNOWN_ISSUES",
          "TEMPORARY_WORKAROUNDS", "SECURITY_RULES", "TESTING_RULES",
          "DEPENDENCIES", "TEAM_GLOSSARY",
        ])
        .describe("Section cần thêm entry vào"),
      entry: z
        .string()
        .describe("Nội dung cần thêm. VD: 'KHÔNG dùng UserService trực tiếp, phải qua UserFacadeService'"),
      reason: z
        .string()
        .optional()
        .describe("Lý do thêm entry này — giúp team hiểu context sau này"),
      contextFilePath: z
        .string()
        .optional()
        .describe("Đường dẫn đến TEAM_CONTEXT.md"),
    },
    withErrorHandler("update_team_context", async ({ section, entry, reason, contextFilePath }) => {
      const filePath = contextFilePath ?? await findContextFile();

      if (!filePath) {
        throw new Error(
          "Không tìm thấy TEAM_CONTEXT.md. " +
          "Hãy tạo file tại thư mục gốc của vnpt-dev-agent."
        );
      }

      let content = await fs.readFile(filePath, "utf-8");

      // Tìm vị trí section để thêm entry vào
      const sectionMarker = `## [${section}]`;
      const sectionIndex = content.indexOf(sectionMarker);

      if (sectionIndex === -1) {
        throw new Error(`Không tìm thấy section [${section}] trong TEAM_CONTEXT.md`);
      }

      // Tìm dòng cuối của section (trước section tiếp theo hoặc cuối file)
      const afterSection = content.indexOf("\n## [", sectionIndex + 1);
      const insertAt = afterSection === -1 ? content.length : afterSection;

      // Format entry mới
      const today = new Date().toISOString().split("T")[0];
      const newEntry = reason
        ? `- ${entry} [Added: ${today} — ${reason}]`
        : `- ${entry} [Added: ${today}]`;

      // Chèn vào đúng vị trí
      content = content.slice(0, insertAt).trimEnd() + "\n" + newEntry + "\n" + content.slice(insertAt);

      // Cập nhật LAST_UPDATED
      content = content.replace(
        /date: .+/,
        `date: ${today}`
      );

      await fs.writeFile(filePath, content, "utf-8");

      return {
        content: [{
          type: "text",
          text: [
            `✅ Đã cập nhật TEAM_CONTEXT.md`,
            `📂 Section: [${section}]`,
            `📝 Entry: ${entry}`,
            reason ? `💡 Lý do: ${reason}` : "",
            "",
            "Lần sau khi AI làm task liên quan, context này sẽ được tự động inject.",
          ].filter(Boolean).join("\n") + getChainHint("update_team_context"),
        }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Tự động tìm file TEAM_CONTEXT.md
 * Tìm ở thư mục hiện tại và parent directories
 */
async function findContextFile(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), "docs/TEAM_CONTEXT.md"),
    path.join(process.cwd(), "..", "docs/TEAM_CONTEXT.md"),
    path.join(path.dirname(process.execPath), "docs/TEAM_CONTEXT.md"),
  ];

  // Cũng tìm theo env variable nếu có
  if (process.env.TEAM_CONTEXT_PATH) {
    candidates.unshift(process.env.TEAM_CONTEXT_PATH);
  }

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // File không tồn tại ở vị trí này
    }
  }

  return null;
}

/**
 * Parse TEAM_CONTEXT.md thành structured object
 */
function parseContextFile(content: string): {
  meta: Record<string, string>;
  sections: Record<string, string[]>;
} {
  const meta: Record<string, string> = {};
  const sections: Record<string, string[]> = {};

  let currentSection: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Bỏ qua comment và dòng trống
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Detect section header: ## [SECTION_NAME]
    const sectionMatch = trimmed.match(/^## \[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = [];
      continue;
    }

    // Detect meta: key: value (trước section đầu tiên)
    if (!currentSection && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":");
      meta[key.trim()] = valueParts.join(":").trim();
      continue;
    }

    // Thêm entry vào section hiện tại
    if (currentSection && trimmed.startsWith("-")) {
      const entry = trimmed.slice(1).trim();
      if (entry && !entry.startsWith("[")) { // Bỏ qua placeholder
        sections[currentSection].push(entry);
      }
    }
  }

  return { meta, sections };
}

/**
 * Tự động detect sections liên quan dựa trên task description
 * Luôn bao gồm ARCHITECTURE và PROJECT làm base context
 */
function detectRelevantSections(taskDescription: string): string[] {
  const desc = taskDescription.toLowerCase();
  const relevant = new Set<string>();

  // Base sections — luôn cần
  relevant.add("ARCHITECTURE");
  relevant.add("PREFERRED_PATTERNS");
  relevant.add("FORBIDDEN_PATTERNS");

  // Auto-detect theo keywords
  for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some((kw) => desc.includes(kw))) {
      relevant.add(section);
    }
  }

  return Array.from(relevant);
}

/**
 * Format context output thành markdown dễ đọc cho AI
 */
function buildContextOutput(
  parsed: { meta: Record<string, string>; sections: Record<string, string[]> },
  targetSections: string[],
  isFiltered: boolean
): string {
  const lines: string[] = [
    "# 📚 Team Context — VNPT AI",
    isFiltered ? "_Đã filter theo task — chỉ hiển thị sections liên quan_" : "_Toàn bộ context_",
    "",
  ];

  // Project meta
  if (Object.keys(parsed.meta).length > 0) {
    lines.push("## Project");
    for (const [key, value] of Object.entries(parsed.meta)) {
      if (!["date", "updated_by", "version"].includes(key)) {
        lines.push(`- **${key}**: ${value}`);
      }
    }
    lines.push("");
  }

  // Sections
  let hasContent = false;
  for (const section of targetSections) {
    const entries = parsed.sections[section];
    if (!entries || entries.length === 0) continue;

    hasContent = true;
    lines.push(`## ${section.replace(/_/g, " ")}`);
    entries.forEach((e) => lines.push(`- ${e}`));
    lines.push("");
  }

  if (!hasContent) {
    lines.push(
      "⚠️ Chưa có context nào được điền vào TEAM_CONTEXT.md.",
      "",
      "Hãy mở file TEAM_CONTEXT.md và điền vào các section liên quan.",
      "Đặc biệt quan trọng: SERVICE_RULES, API_GOTCHAS, FORBIDDEN_PATTERNS."
    );
  } else {
    lines.push(
      "---",
      "⚠️ Đây là context quan trọng nhất — ưu tiên cao hơn best practices thông thường.",
      "Nếu context trên mâu thuẫn với style guide mặc định của framework → **ưu tiên context trên**."
    );
  }

  return lines.join("\n");
}