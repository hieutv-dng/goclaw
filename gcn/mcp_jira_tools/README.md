# mcp-jira-tools

MCP (Model Context Protocol) server providing Jira integration for Claude AI assistants. Enables Claude Desktop, Claude Code, and Claude.ai to interact directly with Jira Server/Data Center.

**Version:** v1.0.0
**Status:** Production-ready
**Target:** Jira Server/Data Center (not Jira Cloud)
**Auth:** Personal Access Token (PAT) Bearer authentication

## Features

- **7 Tools:** List issues, get details, log work, transition issues, add comments, create issues, check status
- **Vietnamese Descriptions:** Optimized for Vietnamese dev teams
- **Drift Detection:** Warns when issue description may be outdated vs comments
- **Tool Chaining:** Suggests next logical action after each tool invocation
- **Safety-First:** Write operations (log work, transition, comment, create) require user confirmation
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
List my open Jira issues
```

Claude will call `list_my_open_issues` tool. You'll see formatted issue list.

## Tools Reference

### 1. list_my_open_issues

**Description:** Liệt kê các issue đang mở của người dùng
**Input:**
- `project` (optional, string): Jira project key (e.g., "XYZ"). Default: JIRA_DEFAULT_PROJECT or empty
- `maxResults` (optional, number): Max issues to return. Default: 10

**Output:** Markdown table with priority, key, summary, status, points

**Example:**

```
User: "Show me open issues"
Claude calls: list_my_open_issues({ project: "XYZ", maxResults: 10 })

Response:
| Priority | Key | Summary | Status | Points |
|---|---|---|---|---|
| 🔴 High | XYZ-123 | Fix login bug | In Progress | 5 |
| 🟡 Medium | XYZ-124 | Add dark mode | To Do | 8 |
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

**Next Step Suggestion:** `log_work` or `update_issue_status`

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

**Next Step Suggestion:** `add_comment` or `update_issue_status`

---

### 4. update_issue_status

**Description:** Chuyển issue sang status khác
**Input:**
- `key` (required, string): Issue key
- `status` (required, string): Target status name (e.g., "In Progress", "Done")

**Safety:** Requires user confirmation before executing

**Output:** New status confirmation + available transitions

**Validation:** Checks if target status is valid for current status (via getTransitions)

**Example:**

```
User: "Move XYZ-123 to Done"
Claude calls: update_issue_status({ key: "XYZ-123", status: "Done" })

[MCP asks for confirmation]
User confirms

Response: "✅ Transitioned XYZ-123 from 'In Progress' to 'Done'"
```

**Next Step Suggestion:** `add_comment`

---

### 5. get_available_transitions

**Description:** Xem danh sách status có thể chuyển cho issue
**Input:**
- `key` (required, string): Issue key

**Output:** List of available target statuses with descriptions

**Example:**

```
User: "What statuses can I move XYZ-123 to?"
Claude calls: get_available_transitions({ key: "XYZ-123" })

Response:
Current Status: In Progress

Available Transitions:
- Code Review (transition ID: 31)
- Done (transition ID: 21)
- Back to To Do (transition ID: 11)
```

**Next Step Suggestion:** `update_issue_status`

---

### 6. add_comment

**Description:** Thêm comment vào issue
**Input:**
- `key` (required, string): Issue key
- `comment` (required, string): Comment text (supports Jira markup or plain text)

**Safety:** Requires user confirmation before executing

**Output:** Confirmation with comment ID + preview

**Example:**

```
User: "Add a comment to XYZ-123: Fixed in commit abc1234"
Claude calls: add_comment({ key: "XYZ-123", comment: "Fixed in commit abc1234" })

[MCP asks for confirmation]
User confirms

Response: "✅ Added comment to XYZ-123 (comment ID: 654321)"
```

**Next Step Suggestion:** `log_work` or `update_issue_status`

---

### 7. create_issue

**Description:** Tạo issue mới
**Input:**
- `project` (required, string): Jira project key
- `summary` (required, string): Issue title
- `description` (required, string): Issue description (supports Jira markup)
- `type` (required, string): Issue type (e.g., "Bug", "Task", "Story")
- `priority` (required, string): Priority level (e.g., "High", "Medium", "Low")

**Safety:** Requires user confirmation before executing

**Output:** New issue key + direct link

**Example:**

```
User: "Create a task in XYZ project: Add export to PDF feature, description: Users need to export reports as PDF, priority: Medium"
Claude calls: create_issue({
  project: "XYZ",
  summary: "Add export to PDF feature",
  description: "Users need to export reports as PDF",
  type: "Task",
  priority: "Medium"
})

[MCP asks for confirmation]
User confirms

Response: "✅ Created issue XYZ-456: Add export to PDF feature\nhttps://jira.company.com/browse/XYZ-456"
```

**Next Step Suggestion:** `add_comment`

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
