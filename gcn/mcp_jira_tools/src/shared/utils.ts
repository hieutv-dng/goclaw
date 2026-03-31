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
  list_issues:
    "→ Tiếp: `get_issue_detail` để đọc chi tiết task cần làm.",
  get_issue_detail:
    "→ Tiếp: `log_work` để ghi nhận effort, hoặc `update_issue` để chuyển trạng thái / thêm comment.",
  log_work:
    "→ Tiếp: `update_issue` để chuyển trạng thái task.",
  update_issue:
    "→ Tiếp: Task đã hoàn tất! Hoặc `list_issues` để xem task tiếp theo.",
  create_issue:
    "→ Tiếp: `get_issue_detail` để xem issue vừa tạo.",
};

/**
 * Lấy chaining hint cho tool. Append vào cuối output.
 */
export function getChainHint(toolName: string): string {
  const hint = TOOL_CHAINING[toolName];
  return hint ? `\n\n---\n📌 **Next step:** ${hint}` : "";
}
