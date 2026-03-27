export declare class JiraClient {
    private http;
    constructor();
    /**
     * Lấy danh sách issues theo JQL
     * JQL (Jira Query Language) cực kỳ mạnh, ví dụ:
     *   assignee = currentUser() AND status = Open
     *   project = VNPTAI AND sprint in openSprints()
     */
    searchIssues(jql: string, maxResults?: number): Promise<any>;
    /**
     * Lấy chi tiết 1 issue theo key (VD: VNPTAI-123)
     * Trả về toàn bộ: description, comments, attachments...
     */
    getIssue(issueKey: string): Promise<any>;
    /**
     * Logwork thời gian lên 1 issue
     * @param timeSpent - Jira format: "2h 30m", "1d", "45m"
     * @param comment   - Mô tả đã làm gì trong khoảng thời gian đó
     */
    addWorklog(issueKey: string, timeSpent: string, comment: string): Promise<any>;
    /**
     * Lấy danh sách transitions có thể thực hiện
     * Mỗi Jira project có workflow riêng nên cần
     * gọi API này trước để biết transitionId
     */
    getTransitions(issueKey: string): Promise<{
        id: string;
        name: string;
    }[]>;
    /**
     * Chuyển trạng thái issue
     * @param transitionName - VD: "In Progress", "In Review", "Done"
     *                         Sẽ tự động tìm ID tương ứng
     * @param resolution     - VD: "Done", "Fixed", "Won't Do". Gửi kèm khi chuyển sang Done/Resolved.
     * @param comment        - Ghi chú khi chuyển trạng thái.
     */
    transitionIssue(issueKey: string, transitionName: string, options?: {
        resolution?: string;
        comment?: string;
    }): Promise<{
        success: boolean;
        transitionedTo: string;
    }>;
    /**
     * Thêm comment vào issue
     */
    addComment(issueKey: string, body: string): Promise<any>;
    /**
     * Tạo issue mới — dùng cho feature tạo sub-task từ .md
     */
    createIssue(payload: {
        projectKey: string;
        summary: string;
        description: string;
        issueType: string;
        parentKey?: string;
        priority?: string;
        labels?: string[];
    }): Promise<any>;
}
export declare const jiraClient: JiraClient;
//# sourceMappingURL=client.d.ts.map