/**
 * Format lỗi thống nhất cho tất cả tools.
 * Trả về MCP-compatible content block.
 */
export declare function formatToolError(toolName: string, error: unknown, suggestions?: string[]): {
    content: Array<{
        type: "text";
        text: string;
    }>;
};
/**
 * Wrapper để bọc handler của tool với try-catch thống nhất.
 * Tự động bắt lỗi và trả về format chuẩn thay vì crash.
 */
export declare function withErrorHandler<TArgs extends Record<string, unknown>, TExtra = any>(toolName: string, handler: (args: TArgs, extra: TExtra) => Promise<{
    content: Array<any>;
}>, errorSuggestions?: string[]): (args: TArgs, extra: TExtra) => Promise<{
    content: Array<any>;
}>;
export declare const TOOL_CHAINING: Record<string, string>;
/**
 * Lấy chaining hint cho tool. Append vào cuối output.
 */
export declare function getChainHint(toolName: string): string;
//# sourceMappingURL=utils.d.ts.map