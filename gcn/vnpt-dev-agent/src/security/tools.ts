import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// Security Tools — Bổ sung #3
//
// 2 tools:
//   1. check_security_flag
//      → Phân tích task description
//      → Detect security-sensitive areas
//      → Trả về flag level + lý do cụ thể
//
//   2. security_review_checklist
//      → Sinh checklist bảo mật theo loại task
//      → Đọc SECURITY_PATTERNS.md để personalize
//      → Human PHẢI sign-off trước khi merge
// ─────────────────────────────────────────────

// ── Keyword map: từ khóa → security domain ──
// Được dùng cho cả 2 tools để detect domain
export const SECURITY_DOMAINS: Record<string, {
  keywords: string[];
  level: "critical" | "high" | "medium";
  description: string;
}> = {
  AUTHENTICATION: {
    keywords: [
      "login", "logout", "đăng nhập", "đăng xuất",
      "auth", "authenticate", "session", "sso",
      "token", "jwt", "oauth", "openid",
      "password", "mật khẩu", "credential",
    ],
    level: "critical",
    description: "Xác thực người dùng",
  },
  AUTHORIZATION: {
    keywords: [
      "permission", "quyền", "phân quyền", "role",
      "guard", "canActivate", "canLoad",
      "admin", "access control", "policy",
    ],
    level: "critical",
    description: "Phân quyền truy cập",
  },
  TOKEN_MANAGEMENT: {
    keywords: [
      "token", "refresh token", "access token",
      "bearer", "api key", "secret",
      "expire", "revoke", "invalidate",
    ],
    level: "critical",
    description: "Quản lý token/key",
  },
  SENSITIVE_DATA: {
    keywords: [
      "cccd", "cmnd", "passport", "hộ chiếu",
      "credit card", "thẻ tín dụng", "payment", "thanh toán",
      "pii", "personal", "cá nhân", "private",
      "encrypt", "decrypt", "mã hóa",
      "social security", "medical", "y tế",
    ],
    level: "critical",
    description: "Dữ liệu nhạy cảm / PII",
  },
  XSS_RISK: {
    keywords: [
      "innerHTML", "html binding", "rich text", "editor",
      "render html", "dynamic content", "user content",
      "sanitize", "bypass", "trusthtml",
      "markdown", "wysiwyg",
    ],
    level: "high",
    description: "Nguy cơ XSS",
  },
  INPUT_VALIDATION: {
    keywords: [
      "input", "form", "submit", "nhập liệu",
      "upload", "file upload", "attachment",
      "search", "tìm kiếm", "filter", "query",
      "user input", "dữ liệu người dùng",
    ],
    level: "medium",
    description: "Validation dữ liệu đầu vào",
  },
  API_INTEGRATION: {
    keywords: [
      "api key", "webhook", "callback", "redirect",
      "cors", "origin", "header",
      "third party", "external", "integration",
    ],
    level: "medium",
    description: "Tích hợp API / external service",
  },
};

// ── System prompt cho security checklist ────
const SECURITY_CHECKLIST_PROMPT = `Bạn là một security engineer chuyên về application security.

Dựa trên thông tin task và security domains được phát hiện, 
sinh ra checklist bảo mật cụ thể mà developer PHẢI kiểm tra trước khi merge.

Trả về JSON sau, không có gì khác:
{
  "checklist": [
    {
      "category": "tên category",
      "item": "điều cần kiểm tra — cụ thể, actionable",
      "how_to_verify": "cách kiểm tra bằng code/test",
      "severity": "critical" | "high" | "medium",
      "code_example_bad": "ví dụ code SAI (optional)",
      "code_example_good": "ví dụ code ĐÚNG (optional)"
    }
  ],
  "mandatory_reviewer": true | false,
  "reviewer_note": "ghi chú cho người review"
}

Quy tắc:
- Mỗi item phải là hành động CỤ THỂ, có thể verify được
- how_to_verify phải là code/command thực tế, không chung chung
- Đưa ra code example khi item liên quan đến pattern cụ thể
- mandatory_reviewer = true nếu task liên quan đến auth/token/PII`;

export function registerSecurityTools(server: McpServer) {

  // ── TOOL 1: Check security flag ──────────────
  server.tool(
    "check_security_flag",
    "Phân tích task description để phát hiện các vùng nhạy cảm bảo mật. " +
    "Trả về security flag level (CRITICAL/HIGH/MEDIUM/NONE) và danh sách " +
    "security domains bị ảnh hưởng. " +
    "LUÔN gọi tool này trước khi implement task liên quan đến auth, token, " +
    "user data, form input, hoặc API integration.",
    {
      issueKey: z.string().describe("Jira issue key"),
      summary: z.string().describe("Tiêu đề task"),
      description: z.string().describe("Mô tả task"),
      autoLoadPatterns: z
        .boolean()
        .default(true)
        .describe("Tự động đọc SECURITY_PATTERNS.md để bổ sung context"),
    },
    withErrorHandler("check_security_flag", async ({ issueKey, summary, description, autoLoadPatterns }) => {
      const text = `${summary} ${description}`.toLowerCase();

      // Detect security domains
      const detected: Array<{
        domain: string;
        level: "critical" | "high" | "medium";
        description: string;
        matchedKeywords: string[];
      }> = [];

      for (const [domain, config] of Object.entries(SECURITY_DOMAINS)) {
        const matched = config.keywords.filter((kw) => text.includes(kw));
        if (matched.length > 0) {
          detected.push({
            domain,
            level: config.level,
            description: config.description,
            matchedKeywords: matched,
          });
        }
      }

      // Tính overall flag level
      const overallLevel =
        detected.some((d) => d.level === "critical") ? "CRITICAL" :
        detected.some((d) => d.level === "high") ? "HIGH" :
        detected.some((d) => d.level === "medium") ? "MEDIUM" : "NONE";

      // Load SECURITY_PATTERNS.md nếu cần
      let patternsContext = "";
      if (autoLoadPatterns && detected.length > 0) {
        const patternsFile = await findFile("SECURITY_PATTERNS.md");
        if (patternsFile) {
          const content = await fs.readFile(patternsFile, "utf-8");
          // Chỉ lấy sections liên quan
          const relevantSections = detected
            .map((d) => d.domain)
            .filter((d) => content.includes(`## [${d}]`));

          if (relevantSections.length > 0) {
            patternsContext = extractSections(content, relevantSections);
          }
        }
      }

      return {
        content: [{
          type: "text",
          text: formatSecurityFlag(issueKey, summary, overallLevel, detected, patternsContext) + getChainHint("check_security_flag"),
        }],
      };
    })
  );

  // ── TOOL 2: Security review checklist ────────
  server.tool(
    "security_review_checklist",
    "Sinh ra checklist bảo mật cụ thể cho task dựa trên security domains đã phát hiện. " +
    "Checklist này developer PHẢI verify từng item trước khi tạo PR. " +
    "Với task CRITICAL — bắt buộc có senior/security engineer review trước khi merge. " +
    "Dùng SAU khi check_security_flag trả về level CRITICAL hoặc HIGH.",
    {
      issueKey: z.string().describe("Jira issue key"),
      summary: z.string().describe("Tiêu đề task"),
      description: z.string().describe("Mô tả task"),
      detectedDomains: z
        .array(z.string())
        .optional()
        .describe(
          "Danh sách security domains từ check_security_flag. " +
          "VD: ['AUTHENTICATION', 'TOKEN_MANAGEMENT']. " +
          "Nếu bỏ trống sẽ auto-detect lại."
        ),
    },
    withErrorHandler("security_review_checklist", async ({ issueKey, summary, description, detectedDomains }) => {
      // Auto-detect domains nếu không truyền vào
      let domains = detectedDomains ?? [];
      if (domains.length === 0) {
        const text = `${summary} ${description}`.toLowerCase();
        for (const [domain, config] of Object.entries(SECURITY_DOMAINS)) {
          if (config.keywords.some((kw) => text.includes(kw))) {
            domains.push(domain);
          }
        }
      }

      if (domains.length === 0) {
        return {
          content: [{
            type: "text",
            text: `✅ Không phát hiện security domain cho ${issueKey}.\nKhông cần security checklist đặc biệt.`,
          }],
        };
      }

      // Load security patterns để làm context cho AI
      const patternsFile = await findFile("SECURITY_PATTERNS.md");
      let patternsContent = "";
      if (patternsFile) {
        patternsContent = await fs.readFile(patternsFile, "utf-8");
      }

      // Build context data cho phân tích
      const userPrompt = [
        `Issue: ${issueKey}`,
        `Summary: ${summary}`,
        `Description: ${description}`,
        `Security domains detected: ${domains.join(", ")}`,
        patternsContent
          ? `\nTeam security patterns:\n${extractSections(patternsContent, domains)}`
          : "",
      ].filter(Boolean).join("\n\n");

      // Trả về data + prompt để model của user tự phân tích
      return {
        content: [{
          type: "text",
          text: [
            "# 🔒 Security Review Checklist — Yêu cầu phân tích",
            "",
            "## [SYSTEM_INSTRUCTION]",
            SECURITY_CHECKLIST_PROMPT,
            "",
            "## [DATA]",
            userPrompt,
            "",
            "## [EXPECTED_OUTPUT]",
            "Hãy phân tích data trên và sinh ra checklist bảo mật theo format JSON:",
            "```",
            `{`,
            `  "checklist_items": [`,
            `    { "category": "tên domain", "item": "mô tả kiểm tra", "severity": "CRITICAL|HIGH|MEDIUM", "how_to_verify": "cách verify" }`,
            `  ],`,
            `  "summary": "tóm tắt rủi ro chính",`,
            `  "requires_senior_review": true/false`,
            `}`,
            "```",
            "",
            "⚠️ Sau khi phân tích xong, hãy trình bày checklist dưới dạng bảng markdown dễ đọc.",
          ].join("\n") + getChainHint("security_review_checklist"),
        }],
      };
    })
  );
}

// ─────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────

function formatSecurityFlag(
  issueKey: string,
  summary: string,
  level: string,
  detected: Array<{ domain: string; level: string; description: string; matchedKeywords: string[] }>,
  patternsContext: string
): string {
  const levelConfig: Record<string, { emoji: string; color: string; action: string }> = {
    CRITICAL: {
      emoji: "🚨",
      color: "ĐỎ",
      action: "Bắt buộc security review trước khi merge. KHÔNG giao AI implement một mình.",
    },
    HIGH: {
      emoji: "🔴",
      color: "CAO",
      action: "Giao AI implement nhưng PHẢI review kỹ từng dòng code security-related.",
    },
    MEDIUM: {
      emoji: "🟡",
      color: "TRUNG BÌNH",
      action: "Giao AI implement, chạy security_review_checklist để verify trước khi merge.",
    },
    NONE: {
      emoji: "✅",
      color: "KHÔNG CÓ",
      action: "Không phát hiện security concern. Có thể giao AI implement bình thường.",
    },
  };

  const config = levelConfig[level];
  const lines: string[] = [
    `# ${config.emoji} Security Flag: ${level}`,
    `**Task:** ${issueKey} — ${summary}`,
    "",
    `## Mức độ: ${config.color}`,
    `**Hành động:** ${config.action}`,
    "",
  ];

  if (detected.length > 0) {
    lines.push("## Security domains phát hiện");
    for (const d of detected) {
      const lvlEmoji = d.level === "critical" ? "🚨" : d.level === "high" ? "🔴" : "🟡";
      lines.push(
        `\n### ${lvlEmoji} ${d.domain} — ${d.description}`,
        `**Keywords matched:** \`${d.matchedKeywords.join("`, `")}\``
      );
    }
    lines.push("");
  }

  if (patternsContext) {
    lines.push(
      "## 📋 Team Security Patterns liên quan",
      patternsContext,
      ""
    );
  }

  if (level !== "NONE") {
    lines.push(
      "---",
      "## Bước tiếp theo",
      "1. Chạy `security_review_checklist` để có checklist cụ thể",
      "2. Verify từng item trong checklist TRƯỚC khi tạo PR",
      level === "CRITICAL"
        ? "3. 🚨 Tag senior/security engineer vào PR để review"
        : "3. Double-check code AI generate theo checklist",
    );
  }

  return lines.join("\n");
}

// (formatChecklist + ChecklistResult removed — no longer used after API removal)

async function findFile(filename: string): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), filename),
    path.join(process.cwd(), "..", filename),
    process.env.TEAM_CONTEXT_PATH
      ? path.join(path.dirname(process.env.TEAM_CONTEXT_PATH), filename)
      : null,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* không tồn tại */ }
  }
  return null;
}

function extractSections(content: string, sectionNames: string[]): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^## \[(.+)\]$/);
    if (sectionMatch) {
      inTarget = sectionNames.includes(sectionMatch[1]);
    }
    if (inTarget && !line.startsWith("#")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) result.push(trimmed);
    }
  }

  return result.join("\n");
}