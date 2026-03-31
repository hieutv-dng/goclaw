import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraClient } from "./client.js";
import { formatIssueForAI, formatIssueListForAI } from "./formatter.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";
import { getCurrentPat, updatePat, validatePat } from "./pat-manager.js";

// ─────────────────────────────────────────────
// registerJiraTools: đăng ký tất cả Jira tools
//
// Mỗi tool gồm 3 phần:
//   1. name        → Claude gọi tool này bằng tên gì
//   2. description → Claude đọc để biết khi nào dùng
//                    (QUAN TRỌNG: viết càng rõ càng tốt!)
//   3. inputSchema → Validate input trước khi gọi API
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// buildUserClause
//
// Tạo JQL clause cho user/role filter.
// Trả về string có trailing " AND " nếu có filter,
// hoặc chuỗi rỗng nếu assigneeFilter = "any".
// ─────────────────────────────────────────────
function buildUserClause(role: string, assigneeFilter: string): string {
  // "any" = không filter user, bỏ qua clause này
  if (assigneeFilter === "any") return "";

  // "unassigned" chỉ áp dụng cho assignee
  if (assigneeFilter === "unassigned") {
    return role === "assignee" ? "assignee is EMPTY AND " : "";
  }

  const userValue = assigneeFilter === "currentUser()"
    ? "currentUser()"
    : `"${assigneeFilter}"`;

  // watcher dùng field "watcher" trong JQL
  const jqlField = role === "watcher" ? "watcher" : role;
  return `${jqlField} = ${userValue} AND `;
}

export function registerJiraTools(server: McpServer) {

  // ── TOOL 1: Lấy danh sách issues ─────────────
  server.tool(
    "list_issues",
    "Lấy danh sách Jira issues theo filter linh hoạt. " +
    "Mặc định: issues được assign cho tôi, đang mở. " +
    "Có thể lọc theo user khác (assigneeFilter), role (assignee/reporter/watcher), " +
    "trạng thái (statusFilter), hoặc JQL tùy chỉnh (customJql = full override). " +
    "Trước đây có tên list_my_open_issues.",
    {
      projectKey: z
        .string()
        .optional()
        .describe("Filter theo project key cụ thể, VD: 'VNPTAI'. Bỏ trống = tất cả project."),
      assigneeFilter: z
        .string()
        .default("currentUser()")
        .describe(
          "User để filter. " +
          "'currentUser()' = tôi (default). " +
          "'unassigned' = chưa assign (chỉ với assignee role). " +
          "'any' = bỏ qua filter user. " +
          "Username cụ thể: 'nghiath', 'admin', v.v."
        ),
      roleFilter: z
        .enum(["assignee", "reporter", "watcher"])
        .default("assignee")
        .describe(
          "Role của user với issue. " +
          "'assignee' = được assign (default). " +
          "'reporter' = người tạo issue. " +
          "'watcher' = người đang theo dõi."
        ),
      statusFilter: z
        .enum(["open", "active", "done", "all"])
        .default("open")
        .describe(
          "Filter theo nhóm trạng thái: " +
          "'open' = Open/To Do/Reopened, " +
          "'active' = In Progress, " +
          "'done' = Done/Resolved/Closed, " +
          "'all' = tất cả."
        ),
      customJql: z
        .string()
        .optional()
        .describe("JQL tùy chỉnh — full override, không inject thêm gì. VD: 'project = VNPTAI AND sprint in openSprints()'"),
      maxResults: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Số lượng tối đa issues trả về"),
    },
    withErrorHandler("list_issues", async ({ projectKey, assigneeFilter, roleFilter, statusFilter, customJql, maxResults }) => {
      const projectFilter = projectKey ? `project = ${projectKey} AND ` : "";

      // Map statusFilter → JQL conditions
      const statusMap: Record<string, string> = {
        open:   `status in ("Open", "To Do", "Reopened")`,
        active: `status in ("In Progress")`,
        done:   `status in ("Done", "Resolved", "Closed")`,
        all:    `status not in ("Cancelled")`,
      };

      let jql: string;
      if (customJql) {
        // Full override — không inject gì thêm vào customJql
        jql = `${projectFilter}${customJql} ORDER BY updated DESC`;
      } else {
        const userClause = buildUserClause(roleFilter, assigneeFilter);
        jql = `${projectFilter}${userClause}${statusMap[statusFilter]} ORDER BY priority DESC, updated DESC`;
      }

      const data = await jiraClient.searchIssues(jql, maxResults);

      // Build label mô tả filter đang dùng
      const statusLabelMap: Record<string, string> = {
        open:   "Open / To Do / Reopened",
        active: "In Progress",
        done:   "Done / Resolved / Closed",
        all:    "Tất cả trạng thái",
      };
      const roleLabel = roleFilter === "assignee" ? "Assignee"
        : roleFilter === "reporter" ? "Reporter" : "Watcher";
      const userLabel = assigneeFilter === "currentUser()" ? "Tôi"
        : assigneeFilter === "unassigned" ? "Chưa assign"
        : assigneeFilter === "any" ? "Tất cả"
        : assigneeFilter;
      const label = customJql
        ? `Custom JQL: ${customJql}`
        : `${roleLabel}: ${userLabel} | Status: ${statusLabelMap[statusFilter]}`;

      if (data.issues.length === 0) {
        return {
          content: [{ type: "text", text: `✅ Không có issue nào (điều kiện: ${label}).` + getChainHint("list_issues") }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `**Filter:** ${label}\n\n` + formatIssueListForAI(data.issues, data.total) + getChainHint("list_issues"),
        }],
      };
    })
  );

  // ── TOOL 2: Lấy chi tiết 1 issue ─────────────
  server.tool(
    "get_issue_detail",
    "Đọc toàn bộ thông tin chi tiết của 1 Jira issue: mô tả đầy đủ, " +
    "comments, sub-tasks, priority, status hiện tại. " +
    "Dùng trước khi phân tích hoặc implement một task cụ thể.",
    {
      issueKey: z
        .string()
        .describe("Jira issue key, VD: 'VNPTAI-123'"),
    },
    withErrorHandler("get_issue_detail", async ({ issueKey }) => {
      const issue = await jiraClient.getIssue(issueKey);
 
      // ── Tự động check drift ────────────────────
      // Không cần gọi tool riêng — warning xuất hiện
      // ngay trong output của get_issue_detail
      const driftWarning = buildQuickDriftWarning(issue);
 
      return {
        content: [{
          type: "text",
          text: driftWarning + formatIssueForAI(issue) + getChainHint("get_issue_detail"),
        }],
      };
    })
  );

  // ── TOOL 3: Logwork ──────────────────────────
  server.tool(
    "log_work",
    "Ghi nhận thời gian làm việc (logwork) lên một Jira issue. " +
    "Dùng sau khi hoàn thành công việc để track effort. " +
    "Ví dụ: đã làm 2 tiếng fix bug VNPTAI-456. " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — không được tự động submit. " +
    "Hiển thị nội dung sẽ log cho user review trước.",
    {
      issueKey: z
        .string()
        .describe("Jira issue key, VD: 'VNPTAI-123'"),
      timeSpent: z
        .string()
        .describe("Thời gian theo format Jira: '2h', '30m', '1h 30m', '1d'. 1d = 8h."),
      comment: z
        .string()
        .describe("Mô tả ngắn gọn đã làm gì trong khoảng thời gian này"),
    },
    withErrorHandler("log_work", async ({ issueKey, timeSpent, comment }) => {
      const result = await jiraClient.addWorklog(issueKey, timeSpent, comment);
      return {
        content: [{
          type: "text",
          text: `✅ Đã logwork thành công!\n` +
                `📌 Issue: ${issueKey}\n` +
                `⏱️  Thời gian: ${timeSpent}\n` +
                `📝 Ghi chú: ${comment}\n` +
                `🆔 Worklog ID: ${result.id}` + getChainHint("log_work"),
        }],
      };
    })
  );

  // ── TOOL 4: Cập nhật issue (transition + comment) ───────
  server.tool(
    "update_issue",
    "Cập nhật Jira issue: chuyển trạng thái, thêm comment, hoặc xem transitions khả dụng. " +
    "Dùng dryRun=true để xem danh sách transitions mà không thay đổi gì. " +
    "Truyền chỉ comment (không transitionName) để thêm ghi chú mà không đổi status. " +
    "Truyền transitionName để chuyển trạng thái (kèm comment, resolution nếu cần). " +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI thay đổi status hoặc thêm comment.",
    {
      issueKey: z.string().describe("Jira issue key, VD: 'VNPTAI-123'"),
      dryRun: z.boolean().default(false)
        .describe("true = chỉ xem transitions khả dụng, không thay đổi gì"),
      transitionName: z.string().optional()
        .describe("Tên trạng thái muốn chuyển. VD: 'In Progress', 'Done'. Bỏ trống nếu chỉ muốn comment."),
      resolution: z.string().optional()
        .describe("Resolution khi đóng task. VD: 'Done', 'Fixed'. Chỉ cần khi chuyển sang Done/Resolved."),
      comment: z.string().optional()
        .describe("Ghi chú kèm theo. Có thể dùng độc lập (không cần transitionName) hoặc kèm transition."),
    },
    withErrorHandler("update_issue", async ({ issueKey, dryRun, transitionName, comment, resolution }) => {
      // Case 1: dryRun — chỉ list transitions
      if (dryRun) {
        const transitions = await jiraClient.getTransitions(issueKey);
        const list = transitions.map((t) => `  • ${t.name} (id: ${t.id})`).join("\n");
        return {
          content: [{
            type: "text",
            text: `Các transition khả dụng cho ${issueKey}:\n${list}` + getChainHint("update_issue"),
          }],
        };
      }

      // Case 2: chỉ comment (không transition)
      if (!transitionName && comment) {
        await jiraClient.addComment(issueKey, comment);
        return {
          content: [{
            type: "text",
            text: `✅ Đã thêm comment vào ${issueKey}:\n\n> ${comment}` + getChainHint("update_issue"),
          }],
        };
      }

      // Case 3: không có gì để làm
      if (!transitionName && !comment) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Không có thay đổi — truyền transitionName để đổi status, comment để thêm ghi chú, hoặc dryRun=true để xem transitions.`,
          }],
        };
      }

      // Case 4: transition (± comment, ± resolution)
      // transitionIssue() gọi getTransitions() internally — không cần gọi trước
      await jiraClient.transitionIssue(issueKey, transitionName!, { resolution, comment });

      const lines = [
        `✅ Đã cập nhật thành công!`,
        `📌 Issue: ${issueKey}`,
        `🔄 Trạng thái mới: ${transitionName}`,
      ];
      if (resolution) lines.push(`✔️ Resolution: ${resolution}`);
      if (comment) lines.push(`💬 Comment: "${comment}"`);

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("update_issue") }],
      };
    })
  );

  // ── TOOL 6: Tạo issue mới (hoặc xem metadata với dryRun) ───────
  server.tool(
    "create_issue",
    "Tạo một Jira issue mới (Task, Sub-task, Bug, Story). " +
    "Dùng dryRun=true để xem metadata (custom fields, users, epics) — không tạo issue. " +
    "Dùng khi phân rã một task lớn thành các sub-task nhỏ hơn, " +
    "hoặc khi tạo task từ file mô tả nghiệp vụ .md. " +
    "Nếu người dùng yêu cầu tạo task mới như 'tạo task mới cho tôi nhé', hãy yêu cầu họ cung cấp các thông tin dựa trên ví dụ sau:\n" +
    "- Dự án (Project Key): GOCONNECT\n" +
    "- Loại Issue: Task\n" +
    "- Tiêu đề: Phối hợp thực AM UBNB Hoài Hôi\n" +
    "- Mô tả: Phối hợp thực AM UBNB Hoài Hôi\n" +
    "- Mức độ ưu tiên: Low\n" +
    "- Nhãn (Labels): GoConnect\n" +
    "- Mã SPDA: VNPT GoConnect\n" +
    "- Công đoạn: Nghiên cứu và phát triển\n" +
    "- Due Date: 2026-04-03\n" +
    "- Assign cho: nghiath (optional)\n" +
    "- Epic: GOCONNECT-100 (optional)\n" +
    "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — hiển thị nội dung issue sẽ tạo cho user duyệt.",
    {
      projectKey: z.string().describe("Project key, VD: 'VNPTAI'"),
      dryRun: z.boolean().default(false)
        .describe("true = chỉ xem metadata (custom fields, users, epics) — không tạo issue"),
      issueType: z
        .enum(["Task", "Sub-task", "Bug", "Story"])
        .default("Task")
        .describe("Loại issue"),
      summary: z.string().optional().describe("Tiêu đề ngắn gọn của issue (bắt buộc khi tạo issue)"),
      description: z.string().optional().describe("Mô tả chi tiết issue (bắt buộc khi tạo issue)"),
      parentKey: z
        .string()
        .optional()
        .describe("Key của issue cha — bắt buộc nếu issueType là Sub-task"),
      priority: z
        .enum(["Highest", "High", "Medium", "Low", "Lowest"])
        .optional()
        .describe("Mức độ ưu tiên (bắt buộc khi tạo issue)"),
      labels: z
        .array(z.string())
        .optional()
        .describe("Danh sách labels, VD: ['backend', 'urgent'] (bắt buộc khi tạo issue)"),
      spda: z
        .string()
        .optional()
        .describe("Mã SPDA (customfield_10100). VD: 'VNPT GoConnect' (bắt buộc khi tạo issue)"),
      congDoan: z
        .string()
        .optional()
        .describe("Công đoạn (customfield_10101). VD: 'Nghiên cứu và phát triển' (bắt buộc khi tạo issue)"),
      dueDate: z
        .string()
        .optional()
        .describe("Ngày hết hạn, format YYYY-MM-DD. VD: '2026-04-15' (bắt buộc khi tạo issue)"),
      assignee: z
        .string()
        .optional()
        .describe(
          "Username của người được assign. Dùng dryRun=true để xem danh sách user khả dụng. " +
          "VD: 'nghiath', 'admin'. Bỏ trống = không assign."
        ),
      epicKey: z
        .string()
        .optional()
        .describe(
          "Key của Epic muốn liên kết. VD: 'GOCONNECT-100'. " +
          "Dùng dryRun=true để xem danh sách Epic đang mở. Bỏ trống = không link Epic."
        ),
    },
    withErrorHandler("create_issue", async (payload) => {
      // ── dryRun: trả metadata (thay thế get_create_meta) ──
      if (payload.dryRun) {
        const lines: string[] = [
          `📋 Create Meta — ${payload.projectKey} / ${payload.issueType}`,
          "",
        ];

        // 1. Custom fields (SPDA, Công đoạn, issuetype, priority)
        try {
          const meta = await jiraClient.getCreateMeta(payload.projectKey, payload.issueType);
          for (const [fieldId, field] of Object.entries(meta.fields)) {
            if (field.allowedValues && field.allowedValues.length > 0) {
              lines.push(`### ${field.name} (${fieldId})`);
              lines.push(`Required: ${field.required ? "✅" : "❌"}`);
              lines.push("Options:");
              for (const opt of field.allowedValues) {
                const label = opt.value || opt.name || "N/A";
                lines.push(`  • id: ${opt.id} → "${label}"`);
              }
              lines.push("");
            }
          }
        } catch {
          lines.push(`⚠️ API createmeta không khả dụng — đọc từ issue gần nhất`, "");
          try {
            const searchData = await jiraClient.searchIssues(
              `project = ${payload.projectKey} ORDER BY created DESC`,
              1
            );
            const latestIssue = searchData.issues?.[0];
            if (latestIssue) {
              const cfData = await jiraClient.getCustomFieldFromIssue(
                latestIssue.key,
                ["customfield_10100", "customfield_10101"]
              );
              if (cfData.customfield_10100) {
                lines.push(`### SPDA (customfield_10100)`);
                lines.push(`  • id: ${cfData.customfield_10100.id} → "${cfData.customfield_10100.value}"`);
                lines.push("");
              }
              if (cfData.customfield_10101) {
                lines.push(`### Công đoạn (customfield_10101)`);
                lines.push(`  • id: ${cfData.customfield_10101.id} → "${cfData.customfield_10101.value}"`);
                lines.push("");
              }
            }
          } catch {
            lines.push(`❌ Không thể đọc fallback data`, "");
          }
        }

        // 2. Assignable users
        try {
          const users = await jiraClient.getAssignableUsers(payload.projectKey);
          if (users.length > 0) {
            lines.push(`### Assignable Users`);
            lines.push(`Tổng: ${users.length} thành viên`);
            for (const u of users) {
              const email = u.emailAddress ? ` (${u.emailAddress})` : "";
              lines.push(`  • name: "${u.name}" → ${u.displayName}${email}`);
            }
            lines.push("");
          }
        } catch {
          lines.push(`⚠️ Không thể lấy danh sách users`, "");
        }

        // 3. Epics đang mở
        try {
          const epics = await jiraClient.searchEpics(payload.projectKey);
          if (epics.length > 0) {
            lines.push(`### Epics đang mở`);
            lines.push(`Tổng: ${epics.length} epic`);
            for (const e of epics) {
              lines.push(`  • ${e.key} → "${e.fields.summary}" [${e.fields.status.name}]`);
            }
            lines.push("");
          }
        } catch {
          lines.push(`⚠️ Không thể lấy danh sách Epics`, "");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") + getChainHint("create_issue") }],
        };
      }

      // ── Tạo issue: validate required fields ──
      if (!payload.summary || !payload.description || !payload.priority ||
          !payload.labels || !payload.spda || !payload.congDoan || !payload.dueDate) {
        return {
          content: [{
            type: "text",
            text: "❌ Thiếu field bắt buộc. Khi tạo issue cần: summary, description, priority, labels, spda, congDoan, dueDate.\n" +
                  "💡 Dùng dryRun=true để xem danh sách giá trị hợp lệ trước.",
          }],
        };
      }

      const result = await jiraClient.createIssue({
        projectKey: payload.projectKey,
        summary: payload.summary,
        description: payload.description,
        issueType: payload.issueType,
        parentKey: payload.parentKey,
        priority: payload.priority,
        labels: payload.labels,
        spda: payload.spda,
        congDoan: payload.congDoan,
        dueDate: payload.dueDate,
        assignee: payload.assignee,
        epicKey: payload.epicKey,
      });
      return {
        content: [{
          type: "text",
          text: `✅ Đã tạo issue thành công!\n` +
                `🔑 Key: ${result.key}\n` +
                `🔗 Link: ${process.env.JIRA_BASE_URL}/browse/${result.key}` + getChainHint("create_issue"),
        }],
      };
    })
  );

  // ── TOOL 8: Quản lý Jira PAT ────────────────
  server.tool(
    "manage_jira_pat",
    "Quản lý Personal Access Token (PAT) của Jira. " +
    "Hỗ trợ 2 hành động:\n" +
    "- 'view': Xem PAT hiện tại (đã mask) và đường dẫn file .env\n" +
    "- 'update': Cập nhật PAT mới — ghi vào .env và reload ngay trong session hiện tại\n" +
    "Dùng khi PAT hết hạn, bị revoke, hoặc cần đổi sang account khác.\n" +
    "⚠️ PHẢI xác nhận với user TRƯỚC KHI cập nhật PAT.",
    {
      action: z
        .enum(["view", "update"])
        .describe("Hành động: 'view' = xem PAT hiện tại (masked), 'update' = cập nhật PAT mới"),
      newPat: z
        .string()
        .optional()
        .describe("PAT mới — bắt buộc khi action = 'update'. Lấy tại: Jira → Profile → Personal Access Tokens → Create Token"),
    },
    withErrorHandler("manage_jira_pat", async ({ action, newPat }) => {
      if (action === "view") {
        const info = getCurrentPat();
        const lines = [
          `🔑 **Jira PAT — Thông tin hiện tại**`,
          "",
          `📁 File .env: \`${info.envPath}\``,
          `📄 File tồn tại: ${info.exists ? "✅ Có" : "❌ Không"}`,
          `🔐 PAT hiện tại: \`${info.masked}\``,
          `🌐 Jira URL: \`${process.env.JIRA_BASE_URL || "(chưa cấu hình)"}\``,
        ];

        if (!info.pat) {
          lines.push(
            "",
            "⚠️ **PAT chưa được cấu hình hoặc file .env không tồn tại.**",
            "Hướng dẫn lấy PAT:",
            "1. Đăng nhập Jira → Click avatar → Profile",
            "2. Vào Personal Access Tokens → Create Token",
            "3. Copy token và dùng action 'update' để cập nhật"
          );
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }

      // ── Action: update ──
      if (!newPat) {
        return {
          content: [{
            type: "text",
            text: "❌ Thiếu tham số `newPat`. Khi action = 'update', bạn phải cung cấp PAT mới.\n\n" +
                  "Hướng dẫn lấy PAT:\n" +
                  "1. Đăng nhập Jira → Click avatar → Profile\n" +
                  "2. Vào Personal Access Tokens → Create Token\n" +
                  "3. Copy token và truyền vào tham số `newPat`",
          }],
        };
      }

      // Validate PAT
      const validation = validatePat(newPat);
      if (!validation.valid) {
        return {
          content: [{
            type: "text",
            text: `❌ PAT không hợp lệ: ${validation.reason}`,
          }],
        };
      }

      // Cập nhật .env + process.env
      const result = updatePat(newPat);

      // Reload JiraClient để dùng PAT mới ngay
      try {
        jiraClient.updatePat(newPat);
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Đã cập nhật .env nhưng không thể reload JiraClient: ${e.message}\n` +
                  "Khởi động lại MCP Server để áp dụng PAT mới.",
          }],
        };
      }

      const lines = [
        `✅ **Đã ${result.action === "updated" ? "cập nhật" : "thêm"} PAT thành công!**`,
        "",
        `📁 File: \`${result.envPath}\``,
        `🔐 PAT cũ: \`${result.previousMasked}\``,
        `🔐 PAT mới: \`${result.newMasked}\``,
        "",
        "🔄 JiraClient đã được reload — các API call tiếp theo sẽ dùng PAT mới.",
        "",
        "💡 Để kiểm tra PAT hoạt động, thử gọi `list_issues` để xem issues.",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    })
  );
}


// ─────────────────────────────────────────────
// buildQuickDriftWarning
//
// Lightweight drift check chạy inline trong
// get_issue_detail — không gọi Claude API,
// chỉ dùng heuristics nhanh để tạo warning.
// Full analysis → dùng check_description_drift
// ─────────────────────────────────────────────
const QUICK_CHANGE_KEYWORDS = [
  "thay đổi", "đổi lại", "sửa lại", "changed", "updated",
  "actually", "instead", "remove", "drop", "cancel",
  "không làm", "bỏ đi", "thay vì", "out of scope",
];
 
function buildQuickDriftWarning(issue: { fields: {
  created: string;
  updated: string;
  comment?: { comments: Array<{ body: string; created: string; author: { displayName: string } }> };
}}): string {
  const fields = issue.fields;
  const now = new Date();
  const createdDate = new Date(fields.created);
  const updatedDate = new Date(fields.updated);
 
  const ageInDays = Math.floor(
    (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const daysSinceUpdate = Math.floor(
    (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24)
  );
 
  const comments = fields.comment?.comments ?? [];
  const commentsAfterUpdate = comments.filter(
    (c) => new Date(c.created) > updatedDate
  );
 
  const changeSignalCount = comments.filter((c) =>
    QUICK_CHANGE_KEYWORDS.some((kw) => c.body.toLowerCase().includes(kw))
  ).length;
 
  // Tính quick drift score
  let score = 0;
  if (ageInDays > 14)                                    score += 20;
  if (daysSinceUpdate > 14 && commentsAfterUpdate.length > 0) score += 25;
  if (commentsAfterUpdate.length > 2)                    score += 20;
  if (changeSignalCount > 0)                             score += 35;
 
  // Chỉ hiện warning nếu score đủ cao
  if (score < 40) return "";
 
  const level = score >= 70 ? "🔴 CAO" : "🟡 TRUNG BÌNH";
  const lines = [
    `> ⚠️ **DRIFT WARNING — Mức độ: ${level}**`,
    `> Task này **${ageInDays} ngày tuổi**, description cập nhật **${daysSinceUpdate} ngày trước**.`,
  ];
 
  if (commentsAfterUpdate.length > 0) {
    lines.push(`> Có **${commentsAfterUpdate.length} comments** sau lần cập nhật description.`);
  }
  if (changeSignalCount > 0) {
    lines.push(`> Phát hiện **${changeSignalCount} comments** có dấu hiệu thay đổi requirement.`);
  }
 
  lines.push(
    `> 👉 Chạy \`extract_latest_requirements\` trước khi implement để đọc requirement thực tế.`,
    "",
    "---",
    ""
  );
 
  return lines.join("\n");
}