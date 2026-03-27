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
        const data = err.response?.data;
        const parts: string[] = [];

        // errorMessages: lỗi chung (VD: "Issue type 'xxx' is not valid")
        if (data?.errorMessages?.length) {
          parts.push(data.errorMessages.join(", "));
        }
        // errors: lỗi theo field (VD: { "customfield_10100": "Invalid value" })
        if (data?.errors && Object.keys(data.errors).length > 0) {
          const fieldErrors = Object.entries(data.errors)
            .map(([field, msg]) => `${field}: ${msg}`)
            .join("; ");
          parts.push(fieldErrors);
        }

        const msg = parts.length > 0 ? parts.join(" | ") : err.message;
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

  // ─── METADATA ──────────────────────────────

  /**
   * Lấy danh sách field + allowed values cho việc tạo issue
   * Gọi endpoint QuickCreateIssue (VNPT Jira Server)
   * Response là JSON array với editHtml escaped — parse bằng regex
   */
  async getCreateMeta(_projectKey: string, _issueTypeName: string) {
    const baseURL = process.env.JIRA_BASE_URL;
    const res = await this.http.get(
      "/secure/QuickCreateIssue!default.jspa?decorator=none",
      {
        baseURL,
        timeout: 30000,
        responseType: "text",
      }
    );

    const body = res.data as string;

    // Danh sách fields cần parse
    const targetFields = [
      "customfield_10100",
      "customfield_10101",
      "issuetype",
      "priority",
    ];

    const fields: Record<string, {
      name: string;
      required: boolean;
      schema: { type: string; custom?: string };
      allowedValues?: Array<{ id: string; value?: string; name?: string }>;
    }> = {};

    for (const fieldId of targetFields) {
      const parsed = this.parseFieldFromQuickCreate(body, fieldId);
      if (parsed) {
        fields[fieldId] = parsed;
      }
    }

    return {
      projectId: "",
      projectKey: _projectKey,
      issueTypeId: "",
      issueTypeName: _issueTypeName,
      fields,
    };
  }

  /**
   * Parse 1 field từ response QuickCreateIssue
   * Response chứa JSON: {"id":"fieldId","label":"...",editHtml":"...escaped HTML..."}
   * editHtml chứa <option value="id">text</option> dạng escaped
   */
  private parseFieldFromQuickCreate(
    body: string,
    fieldId: string
  ): {
    name: string;
    required: boolean;
    schema: { type: string };
    allowedValues: Array<{ id: string; value?: string; name?: string }>;
  } | null {
    // Tìm block JSON cho field: "id":"fieldId","label":"..."
    const labelRegex = new RegExp(
      `"id":"${fieldId}","label":"([^"]*)"[^}]*?"required":(true|false)`,
      "i"
    );
    const labelMatch = body.match(labelRegex);
    if (!labelMatch) return null;

    const label = labelMatch[1];
    const required = labelMatch[2] === "true";

    // Tìm editHtml sau field id — chứa escaped HTML options
    // Pattern: value=\\"10006\\">text</option>
    const fieldIdx = body.indexOf(`"id":"${fieldId}"`);
    if (fieldIdx < 0) return null;

    // Lấy đoạn text từ fieldIdx đến field tiếp theo (hoặc cuối)
    const nextFieldIdx = body.indexOf('{"id":"', fieldIdx + 10);
    const fieldBlock = nextFieldIdx > 0
      ? body.substring(fieldIdx, nextFieldIdx)
      : body.substring(fieldIdx, fieldIdx + 5000);

    // Parse options từ escaped HTML: value=\\"id\\">text</option>
    // Hoặc: value=\\\"id\\\">text</option> (double escaped)
    const optionRegex = /value=\\+"([^\\]+)\\+"[^>]*>([^<]*)<\/?\\?option/gi;
    const options: Array<{ id: string; value?: string; name?: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = optionRegex.exec(fieldBlock)) !== null) {
      const id = match[1].trim();
      const text = match[2].replace(/\\n/g, "").replace(/\s+/g, " ").trim();
      if (id && id !== "-1" && id !== "" && text && text !== "None") {
        options.push({ id, value: text, name: text });
      }
    }

    if (options.length === 0) return null;

    return {
      name: label,
      required,
      schema: { type: "option" },
      allowedValues: options,
    };
  }

  /**
   * Lấy giá trị custom field từ một issue đã tồn tại
   * Dùng làm fallback khi createmeta chậm/không khả dụng
   */
  async getCustomFieldFromIssue(
    issueKey: string,
    fieldIds: string[]
  ): Promise<Record<string, { id: string; value: string } | null>> {
    const res = await this.http.get(`/issue/${issueKey}`, {
      params: { fields: fieldIds.join(",") },
    });

    const result: Record<string, { id: string; value: string } | null> = {};
    for (const fieldId of fieldIds) {
      const val = res.data.fields?.[fieldId];
      if (val && typeof val === "object" && val.id) {
        result[fieldId] = { id: val.id, value: val.value || val.name || "" };
      } else {
        result[fieldId] = null;
      }
    }
    return result;
  }

  // ─── TẠO ISSUE ────────────────────────────

  /**
   * Tạo issue mới
   * Hỗ trợ truyền custom field bằng value (tên) — sẽ tự resolve ID
   * Nếu truyền sai tên, API sẽ báo lỗi rõ ràng
   */
  async createIssue(payload: {
    projectKey: string;
    summary: string;
    description: string;
    issueType: string;
    parentKey?: string;
    priority: string;
    labels: string[];
    spda: string;
    congDoan: string;
    dueDate: string;
  }) {
    // Bước 1: Lấy danh sách options hợp lệ cho custom fields
    let spdaField: { value: string } | { id: string } = { value: payload.spda };
    let congDoanField: { value: string } | { id: string } = { value: payload.congDoan };

    try {
      const meta = await this.getCreateMeta(payload.projectKey, payload.issueType);

      // Auto-resolve SPDA option
      const spdaMeta = meta.fields["customfield_10100"];
      if (spdaMeta?.allowedValues) {
        const match = this.findBestOption(spdaMeta.allowedValues, payload.spda);
        if (match) {
          spdaField = { id: match.id };
        } else {
          const options = spdaMeta.allowedValues.map(o => o.value || o.name).join(", ");
          throw new Error(`Giá trị SPDA "${payload.spda}" không hợp lệ. Các giá trị khả dụng: ${options}`);
        }
      }

      // Auto-resolve Công đoạn option
      const congDoanMeta = meta.fields["customfield_10101"];
      if (congDoanMeta?.allowedValues) {
        const match = this.findBestOption(congDoanMeta.allowedValues, payload.congDoan);
        if (match) {
          congDoanField = { id: match.id };
        } else {
          const options = congDoanMeta.allowedValues.map(o => o.value || o.name).join(", ");
          throw new Error(`Giá trị Công đoạn "${payload.congDoan}" không hợp lệ. Các giá trị khả dụng: ${options}`);
        }
      }
    } catch (err: any) {
      if (err.message.includes("không hợp lệ")) throw err; // Re-throw validation errors

      // Fallback: createmeta chậm/fail → đọc từ issue gần nhất
      try {
        const fallback = await this.resolveOptionsFromExistingIssue(
          payload.projectKey,
          payload.spda,
          payload.congDoan
        );
        spdaField = fallback.spda;
        congDoanField = fallback.congDoan;
      } catch {
        // Nếu cả fallback cũng fail → dùng value gốc, Jira sẽ báo lỗi
      }
    }

    const fields: Record<string, unknown> = {
      project: { key: payload.projectKey },
      summary: payload.summary,
      description: payload.description,
      issuetype: { name: payload.issueType },
      priority: { name: payload.priority },
      labels: payload.labels,
      customfield_10100: spdaField,
      customfield_10101: congDoanField,
      duedate: payload.dueDate,
    };

    if (payload.parentKey) {
      fields.parent = { key: payload.parentKey };
    }

    const res = await this.http.post("/issue", { fields });
    return res.data; // { id, key, self }
  }

  /**
   * Fallback: đọc custom field options từ issue gần nhất trong project
   * Nhanh hơn createmeta nhiều — chỉ cần 1 API call
   */
  private async resolveOptionsFromExistingIssue(
    projectKey: string,
    spdaInput: string,
    congDoanInput: string
  ): Promise<{
    spda: { id: string } | { value: string };
    congDoan: { id: string } | { value: string };
  }> {
    // Lấy 1 issue gần nhất có cả 2 custom field
    const searchRes = await this.http.get("/search", {
      params: {
        jql: `project = ${projectKey} AND customfield_10100 is not EMPTY ORDER BY created DESC`,
        maxResults: 1,
        fields: "customfield_10100,customfield_10101",
      },
    });

    const issue = searchRes.data.issues?.[0];
    if (!issue) {
      return {
        spda: { value: spdaInput },
        congDoan: { value: congDoanInput },
      };
    }

    const cf100 = issue.fields?.customfield_10100;
    const cf101 = issue.fields?.customfield_10101;

    return {
      spda: cf100?.id ? { id: cf100.id } : { value: spdaInput },
      congDoan: cf101?.id ? { id: cf101.id } : { value: congDoanInput },
    };
  }

  /**
   * Tìm option khớp nhất từ danh sách allowedValues
   * So sánh: exact match → lowercase match → contains match
   */
  private findBestOption(
    options: Array<{ id: string; value?: string; name?: string }>,
    input: string
  ): { id: string; value: string } | null {
    const inputLower = input.toLowerCase().trim();

    // 1. Exact match
    for (const opt of options) {
      const val = opt.value || opt.name || "";
      if (val === input) return { id: opt.id, value: val };
    }

    // 2. Case-insensitive match
    for (const opt of options) {
      const val = opt.value || opt.name || "";
      if (val.toLowerCase().trim() === inputLower) return { id: opt.id, value: val };
    }

    // 3. Contains match (input chứa trong option hoặc ngược lại)
    for (const opt of options) {
      const val = (opt.value || opt.name || "").toLowerCase().trim();
      if (val.includes(inputLower) || inputLower.includes(val)) {
        return { id: opt.id, value: opt.value || opt.name || "" };
      }
    }

    return null;
  }
}

// Singleton instance — toàn bộ app dùng chung 1 client
export const jiraClient = new JiraClient();
