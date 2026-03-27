import { z } from "zod";
import { jiraClient } from "./client.js";
import { formatIssueForAI, formatIssueListForAI } from "./formatter.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";
// ─────────────────────────────────────────────
// registerJiraTools: đăng ký tất cả Jira tools
//
// Mỗi tool gồm 3 phần:
//   1. name        → Claude gọi tool này bằng tên gì
//   2. description → Claude đọc để biết khi nào dùng
//                    (QUAN TRỌNG: viết càng rõ càng tốt!)
//   3. inputSchema → Validate input trước khi gọi API
// ─────────────────────────────────────────────
export function registerJiraTools(server) {
    // ── TOOL 1: Lấy danh sách task của tôi ───────
    server.tool("list_my_open_issues", "Lấy danh sách Jira issues được assign cho tôi, lọc theo trạng thái. " +
        "statusFilter: 'open' (Open/To Do/Reopened), 'active' (In Progress), " +
        "'done' (Đã xong), 'all' (tất cả trạng thái). Mặc định: 'open'. " +
        "Trường hợp cần lọc tùy chỉnh: dùng customJql.", {
        projectKey: z
            .string()
            .optional()
            .describe("Filter theo project key cụ thể, VD: 'VNPTAI'. Bỏ trống = tất cả project."),
        statusFilter: z
            .enum(["open", "active", "done", "all"])
            .default("open")
            .describe("Filter theo nhóm trạng thái: " +
            "'open' = Open/To Do/Reopened, " +
            "'active' = In Progress, " +
            "'done' = Done/Resolved/Closed, " +
            "'all' = tất cả."),
        customJql: z
            .string()
            .optional()
            .describe("JQL tùy chỉnh (ghi đè statusFilter). VD: 'status = \"In Review\" AND sprint in openSprints()'"),
        maxResults: z
            .number()
            .min(1)
            .max(50)
            .default(20)
            .describe("Số lượng tối đa issues trả về"),
    }, withErrorHandler("list_my_open_issues", async ({ projectKey, statusFilter, customJql, maxResults }) => {
        const projectFilter = projectKey ? `project = ${projectKey} AND ` : "";
        // Map statusFilter → JQL conditions
        const statusMap = {
            open: `status in ("Open", "To Do", "Reopened")`,
            active: `status in ("In Progress")`,
            done: `status in ("Done", "Resolved", "Closed")`,
            all: `status not in ("Cancelled")`,
        };
        let jql;
        if (customJql) {
            jql = `${projectFilter}assignee = currentUser() AND ${customJql} ORDER BY updated DESC`;
        }
        else {
            jql = `${projectFilter}assignee = currentUser() AND ${statusMap[statusFilter]} ORDER BY priority DESC, updated DESC`;
        }
        const data = await jiraClient.searchIssues(jql, maxResults);
        const filterLabel = {
            open: "Open / To Do / Reopened",
            active: "In Progress",
            done: "Done / Resolved / Closed",
            all: "Tất cả trạng thái",
        };
        const label = customJql ? `Custom: ${customJql}` : filterLabel[statusFilter];
        if (data.issues.length === 0) {
            return {
                content: [{ type: "text", text: `✅ Không có issue nào (điều kiện: ${label}).` + getChainHint("list_my_open_issues") }],
            };
        }
        return {
            content: [{
                    type: "text",
                    text: `**Filter:** ${label}\n\n` + formatIssueListForAI(data.issues, data.total) + getChainHint("list_my_open_issues"),
                }],
        };
    }));
    server.tool("get_issue_detail", "Đọc toàn bộ thông tin chi tiết của 1 Jira issue: mô tả đầy đủ, " +
        "comments, sub-tasks, priority, status hiện tại. " +
        "Dùng trước khi phân tích hoặc implement một task cụ thể.", {
        issueKey: z
            .string()
            .describe("Jira issue key, VD: 'VNPTAI-123'"),
    }, withErrorHandler("get_issue_detail", async ({ issueKey }) => {
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
    }));
    // ── TOOL 3: Logwork ──────────────────────────
    server.tool("log_work", "Ghi nhận thời gian làm việc (logwork) lên một Jira issue. " +
        "Dùng sau khi hoàn thành công việc để track effort. " +
        "Ví dụ: đã làm 2 tiếng fix bug VNPTAI-456. " +
        "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — không được tự động submit. " +
        "Hiển thị nội dung sẽ log cho user review trước.", {
        issueKey: z
            .string()
            .describe("Jira issue key, VD: 'VNPTAI-123'"),
        timeSpent: z
            .string()
            .describe("Thời gian theo format Jira: '2h', '30m', '1h 30m', '1d'. 1d = 8h."),
        comment: z
            .string()
            .describe("Mô tả ngắn gọn đã làm gì trong khoảng thời gian này"),
    }, withErrorHandler("log_work", async ({ issueKey, timeSpent, comment }) => {
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
    }));
    // ── TOOL 4: Cập nhật trạng thái issue ───────
    server.tool("update_issue_status", "Chuyển trạng thái (status) của một Jira issue sang trạng thái mới. " +
        "Ví dụ: chuyển từ 'Open' sang 'In Progress' khi bắt đầu làm, " +
        "hoặc sang 'Done'/'Resolved' khi xong. " +
        "Hỗ trợ gửi kèm Resolution (Done/Fixed) và Comment khi đóng task. " +
        "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — TUYỆT ĐỐI không tự động chuyển trạng thái. " +
        "User cần test và verify trước khi thay đổi status.", {
        issueKey: z
            .string()
            .describe("Jira issue key, VD: 'VNPTAI-123'"),
        transitionName: z
            .string()
            .describe("Tên trạng thái muốn chuyển sang, VD: 'In Progress', 'In Review', 'Done', 'Resolved'"),
        resolution: z
            .string()
            .optional()
            .describe("Resolution khi đóng task. VD: 'Done', 'Fixed', 'Won\\'t Do'. Chỉ cần khi chuyển sang Done/Resolved."),
        comment: z
            .string()
            .optional()
            .describe("Ghi chú kèm theo khi chuyển trạng thái. VD: 'Đã fix bug và test trên staging.'"),
    }, withErrorHandler("update_issue_status", async ({ issueKey, transitionName, resolution, comment }) => {
        // Lấy danh sách transitions có thể làm
        const transitions = await jiraClient.getTransitions(issueKey);
        const available = transitions.map((t) => `"${t.name}"`).join(", ");
        const result = await jiraClient.transitionIssue(issueKey, transitionName, {
            resolution,
            comment,
        });
        const lines = [
            `✅ Đã cập nhật trạng thái thành công!`,
            `📌 Issue: ${issueKey}`,
            `🔄 Trạng thái mới: ${transitionName}`,
        ];
        if (resolution) {
            lines.push(`✔️ Resolution: ${resolution}`);
        }
        if (comment) {
            lines.push(`💬 Comment: "${comment}"`);
        }
        lines.push("", `💡 Các transition có thể dùng: ${available}`);
        return {
            content: [{ type: "text", text: lines.join("\n") + getChainHint("update_issue_status") }],
        };
    }));
    // ── TOOL 5: Xem transitions có thể dùng ─────
    server.tool("get_available_transitions", "Xem danh sách các trạng thái có thể chuyển của một issue. " +
        "Dùng khi không chắc tên transition chính xác trong workflow của project.", {
        issueKey: z.string().describe("Jira issue key"),
    }, withErrorHandler("get_available_transitions", async ({ issueKey }) => {
        const transitions = await jiraClient.getTransitions(issueKey);
        const list = transitions.map((t) => `  • ${t.name} (id: ${t.id})`).join("\n");
        return {
            content: [{
                    type: "text",
                    text: `Các transition có thể thực hiện cho ${issueKey}:\n${list}` + getChainHint("get_available_transitions"),
                }],
        };
    }));
    // ── TOOL 5b: Thêm comment vào issue ─────────
    server.tool("add_comment", "Thêm comment vào một Jira issue. " +
        "Dùng khi cần ghi chú tiến độ, feedback, hoặc kết quả test. " +
        "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gửi comment.", {
        issueKey: z.string().describe("Jira issue key, VD: 'VNPTAI-123'"),
        comment: z.string().describe("Nội dung comment"),
    }, withErrorHandler("add_comment", async ({ issueKey, comment }) => {
        await jiraClient.addComment(issueKey, comment);
        return {
            content: [{
                    type: "text",
                    text: `✅ Đã thêm comment vào ${issueKey}:\n\n> ${comment}` + getChainHint("add_comment"),
                }],
        };
    }));
    // ── TOOL 6: Tạo issue mới ───────────────────
    // (Dùng cho tính năng tạo sub-task từ .md — Phase 4)
    server.tool("create_issue", "Tạo một Jira issue mới (Task, Sub-task, Bug, Story). " +
        "Dùng khi phân rã một task lớn thành các sub-task nhỏ hơn, " +
        "hoặc khi tạo task từ file mô tả nghiệp vụ .md. " +
        "⚠️ PHẢI hỏi user xác nhận TRƯỚC KHI gọi tool này — hiển thị nội dung issue sẽ tạo cho user duyệt.", {
        projectKey: z.string().describe("Project key, VD: 'VNPTAI'"),
        summary: z.string().describe("Tiêu đề ngắn gọn của issue"),
        description: z.string().describe("Mô tả chi tiết issue"),
        issueType: z
            .enum(["Task", "Sub-task", "Bug", "Story"])
            .default("Task")
            .describe("Loại issue"),
        parentKey: z
            .string()
            .optional()
            .describe("Key của issue cha — bắt buộc nếu issueType là Sub-task"),
        priority: z
            .enum(["Highest", "High", "Medium", "Low", "Lowest"])
            .optional()
            .describe("Mức độ ưu tiên"),
        labels: z
            .array(z.string())
            .optional()
            .describe("Danh sách labels, VD: ['backend', 'urgent']"),
    }, withErrorHandler("create_issue", async (payload) => {
        const result = await jiraClient.createIssue(payload);
        return {
            content: [{
                    type: "text",
                    text: `✅ Đã tạo issue thành công!\n` +
                        `🔑 Key: ${result.key}\n` +
                        `🔗 Link: ${process.env.JIRA_BASE_URL}/browse/${result.key}` + getChainHint("create_issue"),
                }],
        };
    }));
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
function buildQuickDriftWarning(issue) {
    const fields = issue.fields;
    const now = new Date();
    const createdDate = new Date(fields.created);
    const updatedDate = new Date(fields.updated);
    const ageInDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysSinceUpdate = Math.floor((now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24));
    const comments = fields.comment?.comments ?? [];
    const commentsAfterUpdate = comments.filter((c) => new Date(c.created) > updatedDate);
    const changeSignalCount = comments.filter((c) => QUICK_CHANGE_KEYWORDS.some((kw) => c.body.toLowerCase().includes(kw))).length;
    // Tính quick drift score
    let score = 0;
    if (ageInDays > 14)
        score += 20;
    if (daysSinceUpdate > 14 && commentsAfterUpdate.length > 0)
        score += 25;
    if (commentsAfterUpdate.length > 2)
        score += 20;
    if (changeSignalCount > 0)
        score += 35;
    // Chỉ hiện warning nếu score đủ cao
    if (score < 40)
        return "";
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
    lines.push(`> 👉 Chạy \`extract_latest_requirements\` trước khi implement để đọc requirement thực tế.`, "", "---", "");
    return lines.join("\n");
}
//# sourceMappingURL=tools.js.map