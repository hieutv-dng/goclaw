# mcp-jira-tools

MCP (Model Context Protocol) server providing Jira integration for Claude AI assistants. Enables Claude Desktop, Claude Code, and Claude.ai to interact directly with Jira Server/Data Center.

**Version:** v1.0.0
**Status:** Production-ready
**Target:** Jira Server/Data Center (not Jira Cloud)
**Auth:** Personal Access Token (PAT) Bearer authentication

## Features

- **6 Tools:** List issues, get details, log work, update issues (transition + comment), create issues, manage PAT
- **Vietnamese Descriptions:** Optimized for Vietnamese dev teams
- **Drift Detection:** Warns when issue description may be outdated vs comments
- **Tool Chaining:** Suggests next logical action after each tool invocation
- **Safety-First:** Write operations (log work, update issue, create issue) require user confirmation
- **Markdown Output:** AI-friendly formatting with priority emojis, quality analysis
- **Remote Deployment:** Ngrok tunnel support for remote Claude access

## Quick Start

### Prerequisites

- Node.js 18+ (ES2022 support)
- Jira Server/Data Center v7+ (not Cloud)
- Personal Access Token (PAT) from Jira

### 1. Create Jira PAT

In Jira Server/Data Center:
1. Go to Settings → Personal Access Tokens
2. Click "Create token"
3. Name: `claude-mcp-tools`
4. Copy the token (you'll need this)

### 2. Clone & Install

```bash
cd gcn/mcp_jira_tools
npm install
```

### 3. Configure Environment

Create `.env.local`:

```bash
JIRA_BASE_URL=https://jira.company.com
JIRA_PAT=<your-pat-token>
JIRA_DEFAULT_PROJECT=XYZ  # Optional
```

Or copy from `.env.example`:

```bash
cp .env.example .env.local
# Edit .env.local with your values
```

### 4. Build & Run

```bash
npm run build       # Compile TypeScript
npm start          # Run server (stdio transport)
```

Server starts listening on stdin/stdout (MCP protocol).

### 5. Connect Claude Desktop

Edit Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/gcn/mcp_jira_tools/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com",
        "JIRA_PAT": "your-pat-token"
      }
    }
  }
}
```

Restart Claude Desktop. Tools now available in conversations.

### 6. Test in Claude

In Claude Desktop, try:

```
Show me open issues
```

Claude will call `list_issues` tool. You'll see formatted issue list.

## Tools Reference

### 1. list_issues

**Description:** Lấy danh sách Jira issues theo filter linh hoạt. Mặc định: issues được assign cho tôi, đang mở.

**Input:**
- `projectKey` (optional, string): Filter theo project key cụ thể. Default: tất cả projects
- `assigneeFilter` (optional, string): User để filter. Default: `currentUser()` (tôi). Khác: `unassigned`, `any`, username cụ thể
- `roleFilter` (optional, string): Role của user. Default: `assignee`. Khác: `reporter`, `watcher`
- `statusFilter` (optional, string): Nhóm trạng thái. Default: `open`. Khác: `active`, `done`, `all`
- `customJql` (optional, string): JQL tùy chỉnh — full override. VD: `project = VNPTAI AND sprint in openSprints()`
- `maxResults` (optional, number): Số lượng tối đa. Default: 20, Max: 50

**Output:** Markdown table with priority, key, summary, status

**Example:**

```
User: "Show me open issues"
Claude calls: list_issues({ assigneeFilter: "currentUser()", statusFilter: "open", maxResults: 20 })

Response:
| Priority | Key | Summary | Status |
|---|---|---|---|
| 🔴 High | XYZ-123 | Fix login bug | In Progress |
| 🟡 Medium | XYZ-124 | Add dark mode | To Do |
```

**Next Step Suggestion:** `get_issue_detail`

---

### 2. get_issue_detail

**Description:** Xem chi tiết issue (description, comments, fields)
**Input:**
- `key` (required, string): Issue key (e.g., "XYZ-123")

**Output:** Detailed markdown with description, quality analysis, recent comments, drift warning (if applicable)

**Drift Detection:**
- Issue age > 30 days + many comments → "⚠️ DRIFT DETECTED"
- Warns if description may be outdated
- Heuristic scoring (not 100% accurate)

**Example:**

```
User: "Show details of XYZ-123"
Claude calls: get_issue_detail({ key: "XYZ-123" })

Response:
## XYZ-123: Fix login bug
**Status:** In Progress | **Priority:** 🔴 High | **Points:** 5

### Description
User cannot login with SSO...

### Quality Analysis
✅ Description has Given-When-Then sections
⚠️ 15 comments since last update (possible drift)

### Recent Comments
- User1 (27/03): Tested on Chrome, works fine
- User2 (25/03): Need LDAP support

### Next Steps
- Log work (record hours)
- Add comment or transition to Code Review
```

**Next Step Suggestion:** `log_work` or `update_issue`

---

### 3. log_work

**Description:** Ghi nhận giờ làm việc
**Input:**
- `key` (required, string): Issue key
- `hours` (required, number): Hours worked (0 < hours ≤ 24)
- `date` (optional, string): ISO date (default: today)
- `comment` (optional, string): Worklog comment

**Safety:** Requires user confirmation before executing

**Output:** Confirmation message with worklog ID

**Example:**

```
User: "Log 4 hours on XYZ-123, testing the fix"
Claude calls: log_work({ key: "XYZ-123", hours: 4, comment: "Testing the fix" })

[MCP asks for confirmation]
User confirms

Response: "✅ Logged 4 hours on XYZ-123 (worklog ID: 123456)"
```

**Next Step Suggestion:** `log_work` or `update_issue`

---

### 4. update_issue

**Description:** Cập nhật Jira issue: chuyển trạng thái, thêm comment, hoặc xem transitions khả dụng.

**Input:**
- `issueKey` (required, string): Issue key (e.g., "VNPTAI-123")
- `dryRun` (optional, boolean): true = chỉ xem transitions khả dụng, không thay đổi gì. Default: false
- `transitionName` (optional, string): Tên trạng thái muốn chuyển (e.g., "In Progress", "Done"). Bỏ trống nếu chỉ muốn comment
- `resolution` (optional, string): Resolution khi đóng task (e.g., "Done", "Fixed"). Chỉ cần khi chuyển sang Done/Resolved
- `comment` (optional, string): Ghi chú kèm theo. Có thể dùng độc lập hoặc kèm transition

**Safety:** Requires user confirmation before executing

**Output:**
- dryRun mode: List of available transitions
- Comment-only: Confirmation with comment preview
- Transition mode: Status change confirmation with optional resolution

**Use Cases:**

1. **View available transitions (no changes):**
```
User: "What statuses can I move XYZ-123 to?"
Claude calls: update_issue({ issueKey: "XYZ-123", dryRun: true })

Response:
Các transition khả dụng cho XYZ-123:
  • Code Review (id: 31)
  • Done (id: 21)
  • Back to To Do (id: 11)
```

2. **Add comment only:**
```
User: "Add a comment to XYZ-123: Fixed in commit abc1234"
Claude calls: update_issue({ issueKey: "XYZ-123", comment: "Fixed in commit abc1234" })

[MCP asks for confirmation]
User confirms

Response: "✅ Đã thêm comment vào XYZ-123:\n\n> Fixed in commit abc1234"
```

3. **Transition with comment and resolution:**
```
User: "Move XYZ-123 to Done"
Claude calls: update_issue({ 
  issueKey: "XYZ-123", 
  transitionName: "Done", 
  resolution: "Fixed",
  comment: "Implementation complete, ready for testing"
})

[MCP asks for confirmation]
User confirms

Response: "✅ Đã cập nhật thành công!\n📌 Issue: XYZ-123\n🔄 Trạng thái mới: Done\n✔️ Resolution: Fixed"
```

**Next Step Suggestion:** `log_work` or `create_issue`

---

### 5. create_issue

**Description:** Tạo một Jira issue mới (Task, Sub-task, Bug, Story). Dùng dryRun=true để xem metadata (custom fields, users, epics) — không tạo issue.

**Input:**
- `projectKey` (required, string): Project key (e.g., "VNPTAI")
- `dryRun` (optional, boolean): true = xem metadata, không tạo issue. Default: false
- `issueType` (optional, string): Loại issue. Default: "Task". Khác: "Sub-task", "Bug", "Story"
- `summary` (optional, string): Tiêu đề ngắn gọn (bắt buộc khi tạo)
- `description` (optional, string): Mô tả chi tiết (bắt buộc khi tạo)
- `parentKey` (optional, string): Key của issue cha (bắt buộc nếu Sub-task)
- `priority` (optional, string): Mức độ ưu tiên (bắt buộc khi tạo). Values: "Highest", "High", "Medium", "Low", "Lowest"
- `labels` (optional, array of strings): Danh sách labels
- `spda` (optional, string): Mã SPDA (customfield_10100)
- `congDoan` (optional, string): Công đoạn (customfield_10101)
- `dueDate` (optional, string): Ngày hết hạn (YYYY-MM-DD format)
- `assignee` (optional, string): Username của người được assign
- `epicKey` (optional, string): Key của Epic muốn liên kết

**Safety:** Requires user confirmation before executing

**Output:**
- dryRun mode: Metadata including custom fields, assignable users, available epics
- Create mode: New issue key + direct link

**Use Cases:**

1. **View metadata before creating (dryRun):**
```
User: "Show me the metadata for GOCONNECT project"
Claude calls: create_issue({ projectKey: "GOCONNECT", dryRun: true, issueType: "Task" })

Response:
📋 Create Meta — GOCONNECT / Task
### SPDA (customfield_10100)
Required: ✅
Options:
  • id: 10 → "VNPT GoConnect"
  • id: 20 → "VNPT AI Platform"

### Assignable Users
Tổng: 5 thành viên
  • name: "nghiath" → Nghĩa Thái (nghia@company.com)
  ...

### Epics đang mở
  • GOCONNECT-100 → "Platform Architecture" [In Progress]
```

2. **Create new issue:**
```
User: "Create a task in GOCONNECT project: Implement OAuth integration, description: Add OAuth2 support for SSO, priority: High"
Claude calls: create_issue({
  projectKey: "GOCONNECT",
  issueType: "Task",
  summary: "Implement OAuth integration",
  description: "Add OAuth2 support for SSO",
  priority: "High",
  labels: ["backend", "feature"],
  spda: "VNPT GoConnect",
  congDoan: "Development",
  dueDate: "2026-04-15",
  assignee: "nghiath"
})

[MCP asks for confirmation]
User confirms

Response: "✅ Đã tạo issue thành công!\n🔑 Key: GOCONNECT-456\n🔗 Link: https://jira.company.com/browse/GOCONNECT-456"
```

**Next Step Suggestion:** `log_work` or `update_issue`

---

### 6. manage_jira_pat

**Description:** Quản lý Personal Access Token (PAT) của Jira.

**Input:**
- `action` (required, string): Hành động. Values: "view" (xem PAT hiện tại), "update" (cập nhật PAT mới)
- `newPat` (optional, string): PAT mới (bắt buộc khi action = "update")

**Safety:** Requires user confirmation before updating

**Output:**
- view mode: Current PAT info (masked), file path, Jira URL
- update mode: Confirmation with old/new PAT comparison

**Use Cases:**

1. **View current PAT:**
```
User: "Show me my current Jira PAT"
Claude calls: manage_jira_pat({ action: "view" })

Response:
🔑 **Jira PAT — Thông tin hiện tại**

📁 File .env: `.env.local`
📄 File tồn tại: ✅ Có
🔐 PAT hiện tại: `{masked token}`
🌐 Jira URL: `https://jira.company.com`
```

2. **Update PAT:**
```
User: "My PAT expired, update it"
Claude calls: manage_jira_pat({ 
  action: "update", 
  newPat: "your-new-token-here" 
})

[MCP asks for confirmation]
User confirms

Response: "✅ Đã cập nhật PAT thành công!
📁 File: `.env.local`
🔐 PAT cũ: `{masked old}`
🔐 PAT mới: `{masked new}`

🔄 JiraClient đã được reload — các API call tiếp theo sẽ dùng PAT mới."
```

---

## Development

### Scripts

```bash
npm run build      # Compile TypeScript → dist/
npm run dev        # Watch mode (tsx watch src/index.ts)
npm start          # Run compiled server (node dist/index.js)
npm run inspect    # Run MCP Inspector (debug tool schemas)
```

### Project Structure

```
src/
├── index.ts                     # Entry point (MCP server + transport)
├── jira/
│   ├── client.ts               # JiraClient class (REST API wrapper)
│   ├── tools.ts                # Tool registration + handlers
│   └── formatter.ts            # Output formatting for AI
└── shared/
    ├── index.ts                # Re-exports
    └── utils.ts                # Error handling + tool chaining
```

### Code Standards

- **Language:** TypeScript (ES2022, strict mode)
- **Naming:** camelCase variables/functions, CONSTANT_CASE for constants, PascalCase for classes/types
- **Error Handling:** `withErrorHandler()` wrapper on all tool handlers
- **Input Validation:** Zod schemas for all tool inputs
- **Comments:** Focus on *why* not *what*
- **No hardcoded secrets:** All config via `.env.local`

See `docs/code-standards.md` for detailed conventions.

### Testing

MCP Inspector helps debug tools:

```bash
npm run inspect
# Opens: http://localhost:8000/
# Use to test tool schemas + responses interactively
```

### Adding a New Tool

1. **Add API method to JiraClient** (`src/jira/client.ts`):
   ```typescript
   async getIssueHistory(issueKey: string) {
     const res = await this.client.get(`/rest/api/2/issue/${issueKey}/changelog`);
     return res.data.values;
   }
   ```

2. **Create Zod schema** (`src/jira/tools.ts`):
   ```typescript
   const GetHistorySchema = z.object({
     key: z.string().min(1)
   });
   ```

3. **Register tool handler** (`src/jira/tools.ts`):
   ```typescript
   server.setRequestHandler(Tool, async (req: ToolRequest) => {
     if (req.params.name === 'get_issue_history') {
       return withErrorHandler(async () => {
         const args = GetHistorySchema.parse(req.params.arguments);
         const history = await jiraClient.getIssueHistory(args.key);
         return {
           content: [{
             type: 'text',
             text: formatHistory(history)
           }]
         };
       });
     }
   });
   ```

4. **Add formatter if needed** (`src/jira/formatter.ts`):
   ```typescript
   function formatHistory(changes: Change[]): string {
     // Return markdown
   }
   ```

5. **Update tool chaining** (`src/shared/utils.ts`):
   ```typescript
   const TOOL_CHAINING = {
     // ...
     'get_issue_history': 'add_comment or update_issue_status'
   };
   ```

6. **Test via MCP Inspector** and verify schema + response.

### Debugging

#### View API Requests
Enable axios debug logs:
```typescript
// In client.ts constructor
this.client.interceptors.request.use(req => {
  console.error(`[API] ${req.method?.toUpperCase()} ${req.url}`);
  return req;
});
```

#### Test Tool Schema
```bash
npm run inspect
# Navigate to tool, fill in inputs, click "Call Tool"
# See request/response JSON
```

#### Check Error Messages
All errors formatted via `formatToolError()` → readable MCP error response.

## Remote Deployment (Optional)

For remote Claude access via ngrok tunnel:

```bash
./start-ngrok-remote.sh
```

This:
1. Pulls supergateway Docker image
2. Runs mcp-jira-tools in container
3. Creates ngrok public URL
4. Outputs Claude Desktop config JSON

See `start-ngrok-remote.sh` for details.

## Troubleshooting

### Tools not showing in Claude

**Check:**
1. MCP server running: `npm start` should output no errors
2. Claude config correct: Verify `~/.claude/claude_desktop_config.json` points to correct `dist/index.js`
3. Environment variables set: `echo $JIRA_BASE_URL` and `echo $JIRA_PAT` should be non-empty
4. Restart Claude Desktop after config changes

### "Authentication failed" error

**Check:**
1. PAT token is valid: Generate new one in Jira if needed
2. Token has correct permissions: Must have read/write access to issues
3. JIRA_BASE_URL is correct: Should be `https://jira.company.com` (no trailing slash)

### "Issue not found" error

**Check:**
1. Issue key is correct: `XYZ-123` (case-sensitive)
2. User has permission: Can access issue in Jira web UI?
3. Project exists: Issue belongs to configured project

### "Timeout" error

**Check:**
1. Jira server is responding: `curl https://jira.company.com` should succeed
2. Network connectivity: VPN connected? Firewall allows outbound HTTPS?
3. Jira server load: Check Jira system status page

### Tool chaining hint not showing

This is optional — if tool returns content without `chainHint` metadata, that's fine. Claude will still work without hint.

## Documentation

- **`docs/project-overview-pdr.md`** — Project purpose, requirements, roadmap
- **`docs/codebase-summary.md`** — File-by-file breakdown, data flow, patterns
- **`docs/code-standards.md`** — Naming, conventions, error handling
- **`docs/system-architecture.md`** — Component architecture, flows, deployment variants

## Security Notes

- **PAT Token:** Store in `.env.local` (never commit to git). Consider vault for production.
- **HTTPS Only:** Jira API calls use HTTPS. ngrok tunnel is HTTPS.
- **Input Validation:** All tool inputs validated via Zod schemas.
- **No Secret Logging:** Error messages don't leak auth tokens.
- **User Confirmation:** Write operations require explicit user approval.

## Known Limitations

- **Jira Cloud:** Not supported (requires OAuth, currently PAT-only)
- **Custom Fields:** Limited support (hardcoded field IDs)
- **Drift Detection:** Heuristic-based (not 100% accurate)
- **Bulk Operations:** Can't update multiple issues in one call
- **Webhooks:** Can't receive Jira notifications (read-only + write on user action)

## Roadmap

- [ ] Jira Cloud support (OAuth flow)
- [ ] Advanced issue search (JQL builder)
- [ ] Bulk transition multiple issues
- [ ] Custom field support (dynamic schema)
- [ ] Issue notification webhooks
- [ ] Performance metrics dashboard

## Contributing

1. Create feature branch: `git checkout -b feat/your-feature`
2. Make changes, ensure TypeScript compiles: `npm run build`
3. Test via MCP Inspector: `npm run inspect`
4. Commit with conventional format: `feat: Add your feature`
5. Push to GitHub

## License

MIT (GoClaw project)

## Support

- **Issues:** GitHub Issues
- **Questions:** Slack #goclaw-dev
- **Jira Docs:** https://docs.atlassian.com/software/jira/guides/rest-api/latest/
- **MCP Spec:** https://modelcontextprotocol.io/

---

**Happy issue tracking with Claude! 🚀**
