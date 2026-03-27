// ─────────────────────────────────────────────
// formatter.ts
//
// Tại sao cần formatter riêng?
// Jira API trả về JSON rất "thô" và lồng sâu.
// AI (Claude) đọc plain text tốt hơn JSON phức tạp.
// Formatter chuyển dữ liệu thành markdown rõ ràng
// để Claude phân tích chính xác hơn.
// ─────────────────────────────────────────────

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string };
    issuetype: { name: string };
    assignee: { displayName: string } | null;
    description: string | null;
    created: string;
    updated: string;
    labels: string[];
    subtasks: Array<{ key: string; fields: { summary: string; status: { name: string } } }>;
    comment: { comments: Array<{ author: { displayName: string }; body: string; created: string }> };
    customfield_10016: number | null; // Story points
    parent?: { key: string; fields: { summary: string } };
  };
}

/**
 * Format danh sách issues thành bảng markdown
 * Giúp Claude nhanh chóng nắm bắt toàn cảnh task list
 */
export function formatIssueListForAI(issues: JiraIssue[], total: number): string {
  const lines: string[] = [
    `# 📋 Danh sách Issues OPEN (${issues.length}/${total} issues)\n`,
  ];

  for (const issue of issues) {
    const f = issue.fields;
    const priority = priorityEmoji(f.priority?.name);
    const storyPoints = f.customfield_10016 ? ` | ${f.customfield_10016} SP` : "";
    const updated = formatDate(f.updated);

    lines.push(
      `## ${priority} [${issue.key}] ${f.summary}`,
      `- **Status:** ${f.status?.name}`,
      `- **Type:** ${f.issuetype?.name}${storyPoints}`,
      `- **Cập nhật:** ${updated}`,
      f.labels?.length ? `- **Labels:** ${f.labels.join(", ")}` : "",
      ""
    );
  }

  lines.push(
    "---",
    `💡 *Dùng \`get_issue_detail\` để đọc chi tiết từng task trước khi implement.*`
  );

  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Format chi tiết 1 issue thành markdown đầy đủ
 * Bao gồm description, comments, subtasks
 */
export function formatIssueForAI(issue: JiraIssue): string {
  const f = issue.fields;
  const lines: string[] = [];

  // Header
  lines.push(
    `# ${priorityEmoji(f.priority?.name)} [${issue.key}] ${f.summary}`,
    ""
  );

  // Metadata
  lines.push(
    "## 📌 Thông tin chung",
    `- **Loại:** ${f.issuetype?.name}`,
    `- **Trạng thái:** ${f.status?.name}`,
    `- **Độ ưu tiên:** ${f.priority?.name}`,
    `- **Assignee:** ${f.assignee?.displayName ?? "Chưa assign"}`,
    `- **Tạo lúc:** ${formatDate(f.created)}`,
    `- **Cập nhật:** ${formatDate(f.updated)}`,
    f.customfield_10016 ? `- **Story Points:** ${f.customfield_10016}` : "",
    f.labels?.length ? `- **Labels:** ${f.labels.join(", ")}` : "",
    f.parent ? `- **Parent:** [${f.parent.key}] ${f.parent.fields.summary}` : "",
    ""
  );

  // Description
  lines.push("## 📝 Mô tả");
  if (f.description) {
    // Jira dùng Jira Markup hoặc ADF — giữ nguyên để AI đọc
    lines.push(cleanJiraMarkup(f.description), "");
  } else {
    lines.push("_(Không có mô tả)_", "");
  }

  // Sub-tasks
  if (f.subtasks?.length) {
    lines.push("## 🔀 Sub-tasks");
    for (const sub of f.subtasks) {
      const statusIcon = sub.fields.status.name === "Done" ? "✅" : "⬜";
      lines.push(`- ${statusIcon} [${sub.key}] ${sub.fields.summary}`);
    }
    lines.push("");
  }

  // Comments (chỉ lấy 5 comment gần nhất)
  const comments = f.comment?.comments ?? [];
  if (comments.length > 0) {
    lines.push("## 💬 Comments gần đây");
    const recent = comments.slice(-5);
    for (const c of recent) {
      lines.push(
        `### ${c.author.displayName} — ${formatDate(c.created)}`,
        cleanJiraMarkup(c.body),
        ""
      );
    }
  }

  // ── Phân tích quality để đưa gợi ý thông minh ──
  const hasSections = (key: string) => new RegExp(`^## \\[${key}\\]`, "m").test(f.description ?? "");
  const sectionCount = ["WHY","WHAT","WHERE","HOW","SCENARIOS","DONE_WHEN"]
    .filter(s => hasSections(s)).length;
  const scenarioCount = (f.description?.match(/^### Scenario/gm) ?? []).length;
  const hasGoodDesc = sectionCount >= 4 && scenarioCount >= 1;

  lines.push(
    "---",
    "## 🤖 Hướng dẫn cho AI — Bước tiếp theo",
    ""
  );

  // Ưu tiên 1: Kiểm tra/bổ sung description nếu kém
  if (!f.description || f.description.trim().length < 50) {
    lines.push(
      "### ⚠️ Description TRỐNG hoặc quá ngắn",
      `1. **BẮT BUỘC** gọi \`generate_gwt_description\` để sinh mô tả chuẩn GWT từ tiêu đề và context.`,
      `2. Hiển thị kết quả cho user duyệt trước khi tiếp tục.`,
      ""
    );
  } else if (!hasGoodDesc) {
    lines.push(
      `### 📝 Description chưa đạt chuẩn (${sectionCount}/6 sections, ${scenarioCount} scenarios)`,
      `1. Gọi \`validate_description_quality\` để chấm điểm chi tiết.`,
      `2. Gọi \`generate_gwt_description\` để bổ sung các phần còn thiếu.`,
      `3. Hiển thị kết quả cho user duyệt.`,
      ""
    );
  } else {
    lines.push(
      `### ✅ Description đạt chuẩn (${sectionCount}/6 sections, ${scenarioCount} scenarios)`,
      ""
    );
  }

  // Ưu tiên 2: Gợi ý bước kế tiếp
  lines.push(
    "### Các bước tiếp theo:",
    `- Gọi \`evaluate_task_complexity\` để chấm điểm độ phức tạp, AI risk, và ước tính giờ.`,
    `- Gọi \`task_kickoff\` để khởi tạo workflow đầy đủ cho task này.`,
    `- Gọi \`detect_files_from_task\` để tìm file liên quan.`,
    `- Gọi \`check_security_flag\` nếu task liên quan auth/token.`,
  );

  return lines.filter((l) => l !== null).join("\n");
}

// ─── Helpers ──────────────────────────────────

function priorityEmoji(priority?: string): string {
  const map: Record<string, string> = {
    Highest: "🔴",
    High: "🟠",
    Medium: "🟡",
    Low: "🟢",
    Lowest: "⚪",
  };
  return map[priority ?? ""] ?? "⚫";
}

function formatDate(isoString: string): string {
  if (!isoString) return "N/A";
  return new Date(isoString).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Jira Markup → plain text đơn giản
 * Loại bỏ các ký tự markup phức tạp mà AI không cần
 */
function cleanJiraMarkup(text: string): string {
  if (!text) return "";
  return text
    .replace(/\{code[^}]*\}([\s\S]*?)\{code\}/g, "\n```\n$1\n```\n")
    .replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, "\n```\n$1\n```\n")
    .replace(/\[([^\]]+)\|([^\]]+)\]/g, "[$1]($2)")
    .replace(/^h([1-6])\.\s/gm, (_, n) => "#".repeat(Number(n)) + " ")
    .replace(/\*([^*]+)\*/g, "**$1**")
    .replace(/_(.*?)_/g, "_$1_")
    .trim();
}
