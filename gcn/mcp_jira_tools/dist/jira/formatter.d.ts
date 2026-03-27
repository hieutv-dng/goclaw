interface JiraIssue {
    key: string;
    fields: {
        summary: string;
        status: {
            name: string;
        };
        priority: {
            name: string;
        };
        issuetype: {
            name: string;
        };
        assignee: {
            displayName: string;
        } | null;
        description: string | null;
        created: string;
        updated: string;
        labels: string[];
        subtasks: Array<{
            key: string;
            fields: {
                summary: string;
                status: {
                    name: string;
                };
            };
        }>;
        comment: {
            comments: Array<{
                author: {
                    displayName: string;
                };
                body: string;
                created: string;
            }>;
        };
        customfield_10016: number | null;
        parent?: {
            key: string;
            fields: {
                summary: string;
            };
        };
    };
}
/**
 * Format danh sách issues thành bảng markdown
 * Giúp Claude nhanh chóng nắm bắt toàn cảnh task list
 */
export declare function formatIssueListForAI(issues: JiraIssue[], total: number): string;
/**
 * Format chi tiết 1 issue thành markdown đầy đủ
 * Bao gồm description, comments, subtasks
 */
export declare function formatIssueForAI(issue: JiraIssue): string;
export {};
//# sourceMappingURL=formatter.d.ts.map