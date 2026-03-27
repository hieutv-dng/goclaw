import axios, { AxiosInstance } from "axios";

// ─────────────────────────────────────────────
// JiraClient: wrapper xung quanh Jira REST API
//
// Tại sao dùng class thay vì function thuần?
// → Giữ 1 instance axios duy nhất, tái dùng
//   connection pool, header không cần set lại
// ─────────────────────────────────────────────
export class JiraClient {
  private http: AxiosInstance;

  constructor() {
    const baseURL = process.env.JIRA_BASE_URL;
    const pat = process.env.JIRA_PAT;

    if (!baseURL || !pat) {
      throw new Error(
        "Thiếu biến môi trường: JIRA_BASE_URL hoặc JIRA_PAT\n" +
        "Hãy copy .env.example → .env và điền vào"
      );
    }

    // Jira Server/DC dùng PAT qua header Bearer
    // Khác Jira Cloud dùng Basic Auth (email:api_token)
    this.http = axios.create({
      baseURL: `${baseURL}/rest/api/2`,
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Timeout 15s — Jira nội bộ đôi khi chậm
      timeout: 15000,
    });

    // Interceptor: log lỗi rõ ràng thay vì crash im lặng
    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const msg = err.response?.data?.errorMessages?.join(", ") || err.message;
        return Promise.reject(new Error(`Jira API [${status}]: ${msg}`));
      }
    );
  }

  // ─── ISSUES ───────────────────────────────

  /**
   * Lấy danh sách issues theo JQL
   * JQL (Jira Query Language) cực kỳ mạnh, ví dụ:
   *   assignee = currentUser() AND status = Open
   *   project = VNPTAI AND sprint in openSprints()
   */
  async searchIssues(jql: string, maxResults = 20) {
    const res = await this.http.get("/search", {
      params: {
        jql,
        maxResults,
        // Chỉ lấy field cần thiết → response nhỏ hơn, nhanh hơn
        fields: [
          "summary",
          "status",
          "priority",
          "assignee",
          "description",
          "issuetype",
          "created",
          "updated",
          "comment",
          "subtasks",
          "parent",
          "labels",
          "customfield_10016", // Story points (tên field có thể khác ở VNPT)
        ].join(","),
      },
    });
    return res.data;
  }

  /**
   * Lấy chi tiết 1 issue theo key (VD: VNPTAI-123)
   * Trả về toàn bộ: description, comments, attachments...
   */
  async getIssue(issueKey: string) {
    const res = await this.http.get(`/issue/${issueKey}`);
    return res.data;
  }

  // ─── WORKLOG ──────────────────────────────

  /**
   * Logwork thời gian lên 1 issue
   * @param timeSpent - Jira format: "2h 30m", "1d", "45m"
   * @param comment   - Mô tả đã làm gì trong khoảng thời gian đó
   */
  async addWorklog(issueKey: string, timeSpent: string, comment: string) {
    const res = await this.http.post(`/issue/${issueKey}/worklog`, {
      timeSpent,
      comment,
      // Mặc định log tại thời điểm hiện tại
      started: new Date().toISOString().replace("Z", "+0000"),
    });
    return res.data;
  }

  // ─── TRANSITIONS (đổi status) ─────────────

  /**
   * Lấy danh sách transitions có thể thực hiện
   * Mỗi Jira project có workflow riêng nên cần
   * gọi API này trước để biết transitionId
   */
  async getTransitions(issueKey: string) {
    const res = await this.http.get(`/issue/${issueKey}/transitions`);
    return res.data.transitions as Array<{ id: string; name: string }>;
  }

  /**
   * Chuyển trạng thái issue
   * @param transitionName - VD: "In Progress", "In Review", "Done"
   *                         Sẽ tự động tìm ID tương ứng
   * @param resolution     - VD: "Done", "Fixed", "Won't Do". Gửi kèm khi chuyển sang Done/Resolved.
   * @param comment        - Ghi chú khi chuyển trạng thái.
   */
  async transitionIssue(
    issueKey: string,
    transitionName: string,
    options?: { resolution?: string; comment?: string }
  ) {
    const transitions = await this.getTransitions(issueKey);
    const target = transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    );

    if (!target) {
      const available = transitions.map((t) => t.name).join(", ");
      throw new Error(
        `Không tìm thấy transition "${transitionName}". ` +
        `Các transition hiện có: ${available}`
      );
    }

    const body: Record<string, unknown> = {
      transition: { id: target.id },
    };

    // Gửi resolution nếu có (VD: "Done", "Fixed")
    if (options?.resolution) {
      body.fields = {
        resolution: { name: options.resolution },
      };
    }

    // Gửi comment nếu có
    if (options?.comment) {
      body.update = {
        comment: [
          { add: { body: options.comment } },
        ],
      };
    }

    await this.http.post(`/issue/${issueKey}/transitions`, body);

    return { success: true, transitionedTo: transitionName };
  }

  // ─── COMMENTS ─────────────────────────────

  /**
   * Thêm comment vào issue
   */
  async addComment(issueKey: string, body: string) {
    const res = await this.http.post(`/issue/${issueKey}/comment`, { body });
    return res.data;
  }

  // ─── TẠO ISSUE ────────────────────────────

  /**
   * Tạo issue mới — dùng cho feature tạo sub-task từ .md
   */
  async createIssue(payload: {
    projectKey: string;
    summary: string;
    description: string;
    issueType: string; // "Task", "Sub-task", "Bug", "Story"
    parentKey?: string; // Nếu là sub-task
    priority?: string;
    labels?: string[];
  }) {
    const fields: Record<string, unknown> = {
      project: { key: payload.projectKey },
      summary: payload.summary,
      description: payload.description,
      issuetype: { name: payload.issueType },
    };

    if (payload.parentKey) {
      fields.parent = { key: payload.parentKey };
    }
    if (payload.priority) {
      fields.priority = { name: payload.priority };
    }
    if (payload.labels?.length) {
      fields.labels = payload.labels;
    }

    const res = await this.http.post("/issue", { fields });
    return res.data; // { id, key, self }
  }
}

// Singleton instance — toàn bộ app dùng chung 1 client
export const jiraClient = new JiraClient();
