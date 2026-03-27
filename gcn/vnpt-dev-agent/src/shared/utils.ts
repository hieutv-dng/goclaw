// ─────────────────────────────────────────────
// Shared utilities cho toàn bộ MCP server
// ─────────────────────────────────────────────

/**
 * Format lỗi thống nhất cho tất cả tools.
 * Trả về MCP-compatible content block.
 */
export function formatToolError(
  toolName: string,
  error: unknown,
  suggestions?: string[]
): { content: Array<{ type: "text"; text: string }> } {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [
    `# ❌ Lỗi — \`${toolName}\``,
    "",
    `**Chi tiết:** ${message}`,
  ];

  if (suggestions && suggestions.length > 0) {
    lines.push(
      "",
      "## 💡 Gợi ý khắc phục",
      ...suggestions.map((s, i) => `${i + 1}. ${s}`),
    );
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Wrapper để bọc handler của tool với try-catch thống nhất.
 * Tự động bắt lỗi và trả về format chuẩn thay vì crash.
 */
export function withErrorHandler<TArgs extends Record<string, unknown>, TExtra = any>(
  toolName: string,
  handler: (args: TArgs, extra: TExtra) => Promise<{ content: Array<any> }>,
  errorSuggestions?: string[]
) {
  return async (args: TArgs, extra: TExtra) => {
    try {
      return await handler(args, extra);
    } catch (error) {
      console.error(`[${toolName}] Error:`, error);
      return formatToolError(toolName, error, errorSuggestions ?? [
        "Kiểm tra lại input parameters",
        "Thử lại sau vài giây",
      ]);
    }
  };
}

// ─────────────────────────────────────────────
// Tool Chaining Map
//
// Gợi ý tool tiếp theo sau mỗi tool.
// Giúp AI biết workflow đúng.
// ─────────────────────────────────────────────

export const TOOL_CHAINING: Record<string, string> = {
  task_kickoff:
    "→ Tiếp: `get_team_context` + `detect_files_from_task` để lấy context, " +
    "hoặc `generate_gwt_description` nếu description chưa chuẩn.",
  get_team_context:
    "→ Tiếp: `detect_files_from_task` hoặc `parse_description` để hiểu task.",
  parse_description:
    "→ Tiếp: `detect_files_from_task` → implement, " +
    "hoặc `check_format_compliance` nếu description thiếu sections.",
  detect_files_from_task:
    "→ Tiếp: Bắt đầu implement! Hoặc `rank_context_files` nếu quá nhiều files.",
  check_format_compliance:
    "→ Tiếp: `generate_gwt_description` nếu cần gen lại description.",
  generate_gwt_description:
    "→ Tiếp: `parse_description` để verify, rồi `detect_files_from_task` để implement.",
  check_security_flag:
    "→ Tiếp: `security_review_checklist` nếu level CRITICAL/HIGH.",
  security_review_checklist:
    "→ Tiếp: Implement với checklist này. Review kỹ trước khi tạo PR.",
  evaluate_task_complexity:
    "→ Tiếp: `task_kickoff` nếu quyết định làm, hoặc `create_issue` để chia subtask.",
  suggest_branch_name:
    "→ Tiếp: Tạo branch → bắt đầu implement → `suggest_commit_message` khi commit.",
  suggest_commit_message:
    "→ Tiếp: Commit → `generate_worklog` → `log_work` → `update_issue_status`.",
  generate_worklog:
    "→ Tiếp: Review nội dung → `log_work` để submit lên Jira.",
  log_work:
    "→ Tiếp: `update_issue_status` → `submit_task_feedback` để hệ thống học hỏi.",
  update_issue_status:
    "→ Tiếp: `submit_task_feedback` + `track_metric` để ghi nhận kết quả.",
  get_git_standard:
    "→ Tiếp: `suggest_branch_name` hoặc `suggest_commit_message`.",
};

/**
 * Lấy chaining hint cho tool. Append vào cuối output.
 */
export function getChainHint(toolName: string): string {
  const hint = TOOL_CHAINING[toolName];
  return hint ? `\n\n---\n📌 **Next step:** ${hint}` : "";
}
