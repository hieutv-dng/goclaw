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

  /**
   * Cập nhật PAT tại runtime — tạo lại axios instance
   * với Bearer token mới mà không cần restart server
   */
  updatePat(newPat: string) {
    const baseURL = process.env.JIRA_BASE_URL;
    if (!baseURL) {
      throw new Error("Thiếu biến môi trường: JIRA_BASE_URL");
    }

    this.http = axios.create({
      baseURL: `${baseURL}/rest/api/2`,
      headers: {
        Authorization: `Bearer ${newPat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 15000,
    });

    // Re-register interceptor
    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const data = err.response?.data;
        const parts: string[] = [];
        if (data?.errorMessages?.length) {
          parts.push(data.errorMessages.join(", "));
        }
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
    assignee?: string;
    epicKey?: string;
  }) {
    // Bước 1: Lấy danh sách options hợp lệ cho custom fields
    let spdaField: { value: string } | { id: string } = { value: payload.spda };
    let congDoanField: { value: string } | { id: string } = { value: payload.congDoan };

    try {
      const meta = await this.getCreateMeta(payload.projectKey, payload.issueType);

      // Auto-resolve SPDA — fuzzy match + top-3 suggestions nếu sai
      const spdaMeta = meta.fields["customfield_10100"];
      if (spdaMeta?.allowedValues) {
        const resolved = this.resolveCustomFieldOption(
          spdaMeta.allowedValues, payload.spda, "Mã SPDA"
        );
        spdaField = { id: resolved.id };
      }

      // Auto-resolve Công đoạn — fuzzy match + top-3 suggestions nếu sai
      const congDoanMeta = meta.fields["customfield_10101"];
      if (congDoanMeta?.allowedValues) {
        const resolved = this.resolveCustomFieldOption(
          congDoanMeta.allowedValues, payload.congDoan, "Công đoạn"
        );
        congDoanField = { id: resolved.id };
      }
    } catch (err: any) {
      // Re-throw validation errors (field không khớp)
      if (err.message.startsWith("[Mã SPDA]") || err.message.startsWith("[Công đoạn]")) {
        throw err;
      }

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

    // Assign thành viên — fuzzy match từ danh sách assignable users
    if (payload.assignee) {
      const resolvedAssignee = await this.resolveAssignee(
        payload.projectKey,
        payload.assignee
      );
      fields.assignee = { name: resolvedAssignee };
    }

    // Epic Link — customfield_10002 trên Jira Server VNPT
    // (customfield_10008 là Cloud standard, VNPT Server dùng _10002)
    if (payload.epicKey) {
      const resolvedEpicKey = await this.resolveEpicKey(
        payload.projectKey,
        payload.epicKey
      );
      fields.customfield_10002 = resolvedEpicKey;
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

  /**
   * Wrapper của findBestOption với error message thông minh:
   * - Nếu match → trả về { id, value }
   * - Nếu không match → throw lỗi kèm top-3 gợi ý ranked by similarity
   * @param fieldLabel - Tên field hiển thị trong error, VD: "Mã SPDA"
   */
  private resolveCustomFieldOption(
    options: Array<{ id: string; value?: string; name?: string }>,
    input: string,
    fieldLabel: string
  ): { id: string; value: string } {
    // Thử fuzzy match trước
    const match = this.findBestOption(options, input);
    if (match) return match;

    // Không match → rank tất cả options theo similarity, lấy top-3
    const scored = options
      .map(o => {
        const label = o.value || o.name || "";
        return { id: o.id, label, score: this.calcSimilarity(input, label) };
      })
      .sort((a, b) => b.score - a.score);

    const topSuggestions = scored
      .slice(0, 3)
      .map(s => `  • "${s.label}"`);

    throw new Error(
      `[${fieldLabel}] Không tìm thấy option khớp với "${input}".\n` +
      `Gợi ý gần nhất:\n${topSuggestions.join("\n")}\n` +
      `Dùng create_issue({ dryRun: true }) để xem đầy đủ danh sách.`
    );
  }

  // ─── USERS & EPICS ─────────────────────────

  /**
   * Lấy danh sách users có thể assign cho project
   * Jira Server endpoint: /user/assignable/search
   */
  async getAssignableUsers(projectKey: string) {
    const res = await this.http.get("/user/assignable/search", {
      params: {
        project: projectKey,
        maxResults: 50,
      },
    });
    return res.data as Array<{
      key: string;
      name: string;
      displayName: string;
      emailAddress?: string;
    }>;
  }

  /**
   * Tìm danh sách Epic đang mở trong project
   * Dùng để hiển thị gợi ý khi tạo issue mới
   */
  async searchEpics(projectKey: string) {
    const res = await this.http.get("/search", {
      params: {
        jql: `project = ${projectKey} AND issuetype = Epic AND status not in (Done, Closed, Resolved) ORDER BY summary ASC`,
        maxResults: 50,
        fields: "summary,status",
      },
    });
    return (res.data.issues || []) as Array<{
      key: string;
      fields: { summary: string; status: { name: string } };
    }>;
  }

  // ─── RESOLVE HELPERS ─────────────────────────

  /**
   * Fuzzy-resolve assignee username từ danh sách assignable users.
   * Ưu tiên: exact name → exact displayName → contains name/displayName/email
   * Nếu không tìm thấy → throw error kèm top-3 gợi ý gần nhất.
   */
  private async resolveAssignee(projectKey: string, input: string): Promise<string> {
    const users = await this.getAssignableUsers(projectKey);
    const q = input.toLowerCase().trim();

    // 1. Exact match trên name (username)
    const exactName = users.find(u => u.name.toLowerCase() === q);
    if (exactName) return exactName.name;

    // 2. Exact match trên displayName
    const exactDisplay = users.find(u => u.displayName.toLowerCase() === q);
    if (exactDisplay) return exactDisplay.name;

    // 3. Contains match trên name hoặc displayName hoặc email
    const partialMatches = users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      (u.emailAddress || "").toLowerCase().includes(q) ||
      q.includes(u.name.toLowerCase())
    );
    if (partialMatches.length === 1) return partialMatches[0].name;
    if (partialMatches.length > 1) {
      // Ưu tiên match đầu tiên của name trước
      const prioritized = partialMatches.sort((a, b) =>
        a.name.toLowerCase().startsWith(q) ? -1 :
        b.name.toLowerCase().startsWith(q) ? 1 : 0
      );
      return prioritized[0].name;
    }

    // Không tìm thấy → đề xuất top-3 gợi ý
    const suggestions = users
      .map(u => ({ u, score: this.calcSimilarity(q, u.name + " " + u.displayName) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => `  • "${x.u.name}" → ${x.u.displayName} (${x.u.emailAddress || "no email"})`);

    throw new Error(
      `Không tìm thấy user khớp với "${input}".\n` +
      `Gợi ý gần nhất:\n${suggestions.join("\n")}\n` +
      `Dùng create_issue({ dryRun: true }) để xem đầy đủ danh sách.`
    );
  }

  /**
   * Fuzzy-resolve Epic key từ danh sách epics đang mở.
   * Ưu tiên: exact key → contains key → contains summary
   * Nếu không tìm thấy → throw error kèm top-3 gợi ý gần nhất.
   */
  private async resolveEpicKey(projectKey: string, input: string): Promise<string> {
    const epics = await this.searchEpics(projectKey);
    const q = input.toLowerCase().trim();

    // 1. Exact key match
    const exactKey = epics.find(e => e.key.toLowerCase() === q);
    if (exactKey) return exactKey.key;

    // 2. Contains key
    const keyMatch = epics.find(e => e.key.toLowerCase().includes(q) || q.includes(e.key.toLowerCase()));
    if (keyMatch) return keyMatch.key;

    // 3. Contains summary
    const summaryMatches = epics.filter(e =>
      e.fields.summary.toLowerCase().includes(q) ||
      q.includes(e.fields.summary.toLowerCase().slice(0, 10))
    );
    if (summaryMatches.length >= 1) return summaryMatches[0].key;

    // Không tìm thấy → đề xuất top-3 gợi ý
    const suggestions = epics
      .map(e => ({ e, score: this.calcSimilarity(q, e.key + " " + e.fields.summary) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => `  • ${x.e.key} → "${x.e.fields.summary}" [${x.e.fields.status.name}]`);

    throw new Error(
      `Không tìm thấy Epic khớp với "${input}".\n` +
      `Gợi ý gần nhất:\n${suggestions.join("\n")}\n` +
      `Dùng create_issue({ dryRun: true }) để xem đầy đủ danh sách.`
    );
  }

  /**
   * Tính độ tương đồng đơn giản giữa 2 chuỗi (0-1)
   * Dùng để sắp xếp gợi ý khi fuzzy match không ra kết quả
   */
  private calcSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    let score = 0;
    // Cộng điểm cho mỗi ký tự chung liên tiếp
    for (let i = 0; i < aLower.length; i++) {
      if (bLower.includes(aLower[i])) score++;
    }
    return score / Math.max(aLower.length, bLower.length);
  }
}


// Singleton instance — toàn bộ app dùng chung 1 client
export const jiraClient = new JiraClient();
