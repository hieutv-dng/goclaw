import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { jiraClient } from "../jira/client.js";
import { resolveStackProfile, type StackProfile, ANGULAR_PROFILE } from "../stack-profiles/index.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

// ─────────────────────────────────────────────
// generate_worklog — Tự gen nội dung logwork
// từ data có sẵn, KHÔNG gọi Claude API.
//
// Nguồn dữ liệu:
//   1. Jira issue: summary, description sections
//   2. [DONE_WHEN] checklist từ description
//   3. [SCENARIOS] từ description
//   4. File đã sửa gần đây (git diff hoặc mtime)
//   5. Metadata: type, tags, sprint
//
// Output: worklog comment chuyên nghiệp
// sẵn sàng để review và submit
// ─────────────────────────────────────────────

// Keywords trong DONE_WHEN → verb mapping
// Giúp gen câu tự nhiên hơn thay vì copy y chang
const VERB_MAP: Array<{ pattern: RegExp; verb: string }> = [
  { pattern: /unit test|viết test|test coverage/i, verb: "Viết unit test" },
  { pattern: /fix|sửa|resolve|bugfix/i, verb: "Sửa lỗi" },
  { pattern: /implement|tạo|create|thêm|add/i, verb: "Implement" },
  { pattern: /refactor|clean|tái cấu trúc/i, verb: "Refactor" },
  { pattern: /review|kiểm tra/i, verb: "Review" },
  { pattern: /deploy|release|publish/i, verb: "Deploy" },
  { pattern: /document|docs|hướng dẫn/i, verb: "Viết document" },
  { pattern: /hiển thị|render|display/i, verb: "Implement UI" },
  { pattern: /validate|validation/i, verb: "Thêm validation" },
  { pattern: /api|endpoint|service/i, verb: "Integrate API" },
];

function getVerb(text: string): string {
  for (const { pattern, verb } of VERB_MAP) {
    if (pattern.test(text)) return verb;
  }
  return "Hoàn thành";
}

// ── Parse description sections ──────────────

function extractSection(description: string, sectionKey: string): string[] {
  const lines = description.split("\n");
  const results: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.trim() === `## [${sectionKey}]`) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## [")) {
      break; // Next section
    }
    if (inSection) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("<!--")) {
        results.push(trimmed);
      }
    }
  }
  return results;
}

function parseDoneWhen(description: string): string[] {
  return extractSection(description, "DONE_WHEN")
    .filter((l) => l.startsWith("- ["))
    .map((l) => l.replace(/^- \[[ x✓]\] ?/, "").trim())
    .filter(Boolean);
}

function parseScenarioNames(description: string): string[] {
  return extractSection(description, "SCENARIOS")
    .filter((l) => l.startsWith("### Scenario"))
    .map((l) => l.replace(/^### Scenario \d+: /, "").trim())
    .filter(Boolean);
}

function parseWhere(description: string): {
  component?: string; service?: string; api?: string;
} {
  const lines = extractSection(description, "WHERE");
  const get = (prefix: string) => {
    const line = lines.find((l) => l.includes(prefix));
    return line ? line.split("`")[1] : undefined;
  };
  return {
    component: get("Component:"),
    service: get("Service:"),
    api: get("API:"),
  };
}

function parseMetadataTags(description: string): string[] {
  const lines = extractSection(description, "AI_METADATA");
  const tagLine = lines.find((l) => l.startsWith("tags:"));
  if (!tagLine) return [];
  return tagLine
    .replace("tags:", "")
    .replace(/[\[\]]/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("VD:"));
}

// ── Recent files detector ────────────────────

async function getRecentlyModifiedFiles(
  projectRoot: string,
  withinMinutes: number,
  profile?: StackProfile
): Promise<string[]> {
  const activeProfile = profile ?? ANGULAR_PROFILE;
  const IGNORE = [...new Set(["node_modules", ".git", "dist", "coverage", ...activeProfile.ignorePatterns])];
  const validExtensions = activeProfile.extensions;
  const results: string[] = [];
  const cutoff = Date.now() - withinMinutes * 60 * 1000;

  async function walk(dir: string, depth = 0) {
    if (depth > 6) return;
    let entries: string[];
    try { entries = await fs.readdir(dir); }
    catch { return; }

    for (const entry of entries) {
      if (IGNORE.some((ig) => entry === ig || entry.startsWith("."))) continue;
      const full = path.join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walk(full, depth + 1);
        } else if (stat.mtimeMs > cutoff) {
          const ext = path.extname(entry);
          if (validExtensions.includes(ext)) {
            results.push(path.relative(projectRoot, full));
          }
        }
      } catch { /* skip */ }
    }
  }

  await walk(projectRoot);
  // Sort by recency — most recent first
  return results.slice(0, 8);
}

// ── Worklog content builder ──────────────────

function buildWorklogContent(params: {
  summary: string;
  issueType: string;
  doneWhen: string[];
  scenarioNames: string[];
  where: { component?: string; service?: string; api?: string };
  recentFiles: string[];
  tags: string[];
  additionalNotes: string;
}): string {
  const lines: string[] = [];

  const {
    summary, issueType, doneWhen, scenarioNames,
    where, recentFiles, tags, additionalNotes,
  } = params;

  // ── Header ──
  const typeLabel =
    issueType === "Bug" ? "Fix bug" :
    issueType === "Story" ? "Implement story" :
    issueType === "Sub-task" ? "Hoàn thành sub-task" :
    "Implement task";

  lines.push(`${typeLabel}: ${summary}`);
  lines.push("");

  // ── Công việc đã làm từ DONE_WHEN ──
  if (doneWhen.length > 0) {
    lines.push("Công việc đã thực hiện:");
    for (const item of doneWhen) {
      const verb = getVerb(item);
      // Tránh copy nguyên xi — viết lại ngắn gọn hơn
      const cleaned = item
        .replace(/^(Implement|Tạo|Create|Add|Thêm|Fix|Sửa)\s+/i, "")
        .replace(/unit test coverage >= \d+%/i, "unit tests")
        .replace(/Không có lint warning/i, "")
        .trim();
      if (cleaned) {
        lines.push(`- ${verb}: ${cleaned}`);
      }
    }
    lines.push("");
  }

  // ── Scenarios đã cover ──
  if (scenarioNames.length > 0) {
    lines.push(`Đã implement và test ${scenarioNames.length} scenarios:`);
    scenarioNames.forEach((s, i) => lines.push(`- Scenario ${i + 1}: ${s}`));
    lines.push("");
  }

  // ── Files thay đổi ──
  if (recentFiles.length > 0) {
    lines.push("Files thay đổi:");
    recentFiles.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  // ── Technical context ──
  const techParts: string[] = [];
  if (where.component) techParts.push(`Component: ${where.component}`);
  if (where.service) techParts.push(`Service: ${where.service}`);
  if (where.api) techParts.push(`API: ${where.api}`);
  if (techParts.length > 0) {
    lines.push(techParts.join(" | "));
    lines.push("");
  }

  // ── Additional notes ──
  if (additionalNotes.trim()) {
    lines.push("Ghi chú:");
    lines.push(additionalNotes.trim());
  }

  return lines
    .join("\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n"); // No triple newlines
}

// ── Tool registration ────────────────────────

export function registerWorklogTools(server: McpServer) {

  server.tool(
    "generate_worklog",
    "Tự động tạo nội dung logwork từ thông tin task và file đã sửa. " +
    "KHÔNG gọi Claude API — gen từ data thực tế: [DONE_WHEN] checklist, " +
    "scenario names, file đã thay đổi gần đây, và WHERE context. " +
    "Trả về nội dung sẵn sàng review, sau đó dùng log_work để submit lên Jira. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi — nếu autoSubmit=true, user PHẢI đồng ý trước.",
    {
      issueKey: z
        .string()
        .describe("Jira issue key. VD: 'VNPTAI-123'"),
      timeSpent: z
        .string()
        .describe("Thời gian đã làm theo Jira format: '2h', '1h 30m', '45m'"),
      projectRoot: z
        .string()
        .optional()
        .describe(
          "Đường dẫn gốc codebase để tìm file đã sửa gần đây. " +
          "VD: 'D:/projects/my-app'. Bỏ trống nếu không cần."
        ),
      recentFileWindowMinutes: z
        .number()
        .default(480)
        .describe("Tìm file đã sửa trong N phút gần nhất. Default: 480 (8 giờ = 1 ngày làm việc)"),
      additionalNotes: z
        .string()
        .default("")
        .describe("Ghi chú thêm muốn append vào worklog. VD: 'Blocked bởi API chưa sẵn sàng'"),
      autoSubmit: z
        .boolean()
        .default(false)
        .describe("Nếu true → tự động submit luôn sau khi gen. Nếu false → chỉ preview để review trước."),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack. 'auto' = tự detect từ project root."),
      tested: z
        .boolean()
        .default(false)
        .describe(
          "User đã test chức năng chưa? Nếu false → hiển cảnh báo nhắc test trước. " +
          "Nếu autoSubmit=true nhưng tested=false → chặn submit và yêu cầu test trước."
        ),
    },
    withErrorHandler("generate_worklog", async ({
      issueKey, timeSpent, projectRoot,
      recentFileWindowMinutes, additionalNotes, autoSubmit, stack, tested,
    }) => {
      // ── 1. Đọc Jira issue ──────────────────
      const issue = await jiraClient.getIssue(issueKey);
      const fields = issue.fields;
      const description: string = fields.description ?? "";
      const summary: string = fields.summary ?? "";
      const issueType: string = fields.issuetype?.name ?? "Task";

      // ── 2. Parse description sections ──────
      const doneWhen = parseDoneWhen(description);
      const scenarioNames = parseScenarioNames(description);
      const where = parseWhere(description);
      const tags = parseMetadataTags(description);

      // ── 3. Tìm file đã sửa gần đây ─────────
      let recentFiles: string[] = [];
      if (projectRoot) {
        try {
          const profile = await resolveStackProfile(stack, projectRoot);
          recentFiles = await getRecentlyModifiedFiles(
            projectRoot,
            recentFileWindowMinutes,
            profile
          );
        } catch { /* Bỏ qua nếu không đọc được */ }
      }

      // ── 4. Build worklog content ────────────
      const comment = buildWorklogContent({
        summary,
        issueType,
        doneWhen,
        scenarioNames,
        where,
        recentFiles,
        tags,
        additionalNotes,
      });

      // ── 5. Kiểm tra tested trước khi submit ────
      if (autoSubmit && !tested) {
        return {
          content: [{
            type: "text",
            text: [
              `# ⛔ Chưa thể submit — ${issueKey}`,
              "",
              "🧪 **Bạn chưa xác nhận đã test!**",
              "",
              "Trước khi submit logwork, hãy:",
              "1. Test thủ công chức năng đã implement",
              "2. Kiểm tra không có bug phát sinh",
              "3. Gọi lại với `tested: true` khi đã sẵn sàng",
            ].join("\n") + getChainHint("generate_worklog"),
          }],
        };
      }

      if (autoSubmit) {
        await jiraClient.addWorklog(issueKey, timeSpent, comment);
        return {
          content: [{
            type: "text",
            text: [
              `# ✅ Đã logwork — ${issueKey}`,
              `⏱️ Thời gian: ${timeSpent}`,
              "",
              "## Nội dung đã submit:",
              "```",
              comment,
              "```",
            ].join("\n") + getChainHint("generate_worklog"),
          }],
        };
      }

      // Preview mode — cho user review trước
      return {
        content: [{
          type: "text",
          text: [
            `# 📝 Preview Worklog — ${issueKey}`,
            `⏱️ Thời gian: **${timeSpent}**`,
            "",
            "## Nội dung sẽ được submit:",
            "```",
            comment,
            "```",
            "",
            "---",
            "## Tùy chỉnh trước khi submit",
            `- Thêm ghi chú: dùng tham số \`additionalNotes\``,
            `- Sửa thời gian: đổi \`timeSpent\``,
            `- Submit ngay: gọi lại với \`autoSubmit: true\``,
            "",
            `Hoặc dùng \`log_work\` trực tiếp với nội dung trên:`,
            "```",
            `log_work("${issueKey}", "${timeSpent}", "<nội dung trên>")`,
            "```",

            // Warnings nếu thiếu data
            doneWhen.length === 0
              ? "\n⚠️ Description thiếu [DONE_WHEN] — nội dung gen có thể ngắn. Thêm checklist vào description để có worklog chi tiết hơn."
              : "",
            recentFiles.length === 0 && projectRoot
              ? "\n⚠️ Không tìm thấy file thay đổi gần đây — thử tăng `recentFileWindowMinutes`."
              : "",
            !tested
              ? "\n🧪 **Nhắc nhở:** Hãy test thủ công trước khi submit. Gọi lại với `tested: true` khi sẵn sàng."
              : "",
          ].filter(Boolean).join("\n") + getChainHint("generate_worklog"),
        }],
      };
    })
  );
}