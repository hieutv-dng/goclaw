# mcp-jira-tools: System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│ Claude Desktop / Claude Code (User Interface)       │
└─────────────────────┬───────────────────────────────┘
                      │ stdio (MCP Protocol v3)
                      ↓
┌─────────────────────────────────────────────────────┐
│ mcp-jira-tools Server (Node.js/TypeScript)          │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌──────────────────────────┐   │
│ │ MCP Server      │  │ Tool Handlers (6 tools)  │   │
│ │ - connect       │  │ - list_issues            │   │
│ │ - resources     │  │ - get_issue_detail       │   │
│ │ - tools         │  │ - log_work               │   │
│ │ - prompts       │  │ - update_issue           │   │
│ │                 │  │ - create_issue           │   │
│ │                 │  │ - manage_jira_pat        │   │
│ └─────────────────┘  └──────────────────────────┘   │
│         ↓                    ↓                       │
│  ┌──────────────────────────────────┐               │
│  │ Business Logic Layer             │               │
│  ├──────────────────────────────────┤               │
│  │ • Input Validation (Zod)         │               │
│  │ • Error Handling (withErrorHandler│               │
│  │ • Drift Detection (heuristic)     │               │
│  │ • Tool Chaining Hints             │               │
│  └──────────────────────────────────┘               │
│         ↓                                           │
│  ┌──────────────────────────────────┐               │
│  │ JiraClient (Singleton)           │               │
│  ├──────────────────────────────────┤               │
│  │ • axios HTTP client               │               │
│  │ • Bearer PAT authentication       │               │
│  │ • 15s timeout + error interceptor │               │
│  │ • REST API v2 methods             │               │
│  └──────────────────────────────────┘               │
│         ↓                                           │
│  ┌──────────────────────────────────┐               │
│  │ Formatter Layer                  │               │
│  ├──────────────────────────────────┤               │
│  │ • formatIssueListForAI()          │               │
│  │ • formatIssueForAI()              │               │
│  │ • cleanJiraMarkup()               │               │
│  │ • priorityEmoji()                 │               │
│  └──────────────────────────────────┘               │
└─────────────────────┬───────────────────────────────┘
                      │ HTTPS (axios)
                      ↓
┌─────────────────────────────────────────────────────┐
│ Jira Server / Data Center                           │
│ REST API v2 Endpoints:                              │
│ • /rest/api/2/search (JQL queries)                  │
│ • /rest/api/2/issue/{key} (issue details)           │
│ • /rest/api/2/issue/{key}/worklog (time logging)    │
│ • /rest/api/2/issue/{key}/transitions (status flow) │
│ • /rest/api/2/issue/{key}/comment (comments)        │
│ • /rest/api/2/issue (create issue)                  │
└─────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. MCP Server Layer (index.ts)

**Responsibility:** Lifecycle management, tool registration, transport binding.

```typescript
┌─────────────────────────────────┐
│ McpServer                       │
├─────────────────────────────────┤
│ initialize() → register tools    │
│ connect(StdioServerTransport)    │
│ handle(ToolRequest) → ToolResult │
└─────────────────────────────────┘
        ↓
┌─────────────────────────────────┐
│ StdioServerTransport            │
├─────────────────────────────────┤
│ Reads stdin (MCP protocol)      │
│ Writes stdout (MCP responses)    │
│ Bidirectional communication      │
└─────────────────────────────────┘
```

**Flow:**
1. Claude sends `ToolRequest` via stdin (MCP format)
2. Server parses request → identifies tool name
3. Invokes tool handler (from tools.ts)
4. Returns `ToolResponse` via stdout (MCP format)

### 2. Tool Registration Layer (tools.ts)

**Responsibility:** Define tool schemas, validate inputs, invoke handlers, format outputs.

```
User Request
    ↓
[Tool: list_my_open_issues]
    ├─ Input Schema (Zod)
    │  └─ { project?: string, maxResults?: number }
    ├─ Validation
    │  └─ Parse args, throw if invalid
    ├─ Handler
    │  └─ Call JiraClient.searchIssues()
    ├─ Format Output
    │  └─ formatIssueListForAI() → Markdown
    └─ Add Metadata
       └─ chainHint: "get_issue_detail"
```

**For Each Tool:**

| Tool | Input | Processing | Output |
|---|---|---|---|
| `list_issues` | JQL + filters | searchIssues() + filter | Issue list table |
| `get_issue_detail` | Issue key | getIssue() + drift check | Detail markdown + warning |
| `log_work` | key, hours, date | addWorklog() | Confirmation message |
| `update_issue` | key, status, comment | getTransitions() → transitionIssue() + addComment() | New status message |
| `create_issue` | project, summary, fields | createIssue() + fuzzy resolve custom fields | New issue key + link |
| `manage_jira_pat` | action: get/update | getCurrentPat() or updatePat() | PAT metadata or update result |

**Safety Layer:**
```
Input Args
    ↓
[mcp-config.json Check]
    ├─ Is tool in requireConfirmation?
    │  ├─ YES → Prompt user confirmation
    │  │         (CLI stdin read)
    │  └─ NO → Skip confirmation
    ↓
Execute Handler
    ↓
Return ToolResponse
```

### 3. JiraClient Layer (client.ts)

**Responsibility:** HTTP communication, error handling, API abstraction.

```typescript
┌────────────────────────────────────┐
│ JiraClient (Singleton)             │
├────────────────────────────────────┤
│ constructor(baseUrl, pat)          │
│ • Create axios instance            │
│ • Set Bearer auth header           │
│ • Set 15s timeout                  │
│ • Add error interceptor            │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ Public Methods                     │
├────────────────────────────────────┤
│ searchIssues(jql) → Issue[]         │
│ getIssue(key) → Issue              │
│ addWorklog(key, hours) → worklogId │
│ getTransitions(key) → Transition[] │
│ transitionIssue(key, id) → void    │
│ addComment(key, text) → commentId  │
│ createIssue(payload) → issueKey    │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ Error Handling                     │
├────────────────────────────────────┤
│ • Intercept response errors        │
│ • Extract error message from API   │
│ • Throw formatted Error            │
│ • (Caller wraps with formatToolErr)│
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ axios Instance                     │
├────────────────────────────────────┤
│ baseURL: JIRA_BASE_URL             │
│ timeout: 15000ms                   │
│ headers: Authorization: Bearer PAT │
└────────────────────────────────────┘
```

**API Endpoints Called:**

```
GET  /rest/api/2/search?jql=...&maxResults=...
GET  /rest/api/2/issue/{key}?fields=...
GET  /rest/api/2/issue/{key}/transitions
POST /rest/api/2/issue/{key}/worklog
POST /rest/api/2/issue/{key}/transitions (transition)
POST /rest/api/2/issue/{key}/comment
POST /rest/api/2/issue (create)
```

### 4. Formatter Layer (formatter.ts)

**Responsibility:** Convert Jira objects → AI-friendly markdown.

```
Jira Issue Object (JSON)
    ↓
[formatIssueForAI()]
    ├─ Extract fields (summary, description, status, priority)
    ├─ Clean Jira markup (h1, bold, lists)
    ├─ Add priority emoji (🔴 High, 🟡 Medium, 🟢 Low)
    ├─ Analyze description quality (GWT sections?)
    ├─ Check for drift (age + comments + keywords)
    ├─ Format dates (vi-VN locale)
    └─ Build markdown text
    ↓
Markdown Output
    ↓
Claude Reads Naturally
```

**Output Examples:**

**List View (formatIssueListForAI):**
```markdown
| Priority | Key | Summary | Status | Points |
|---|---|---|---|---|
| 🔴 High | XYZ-1 | Fix login bug | In Progress | 5 |
| 🟡 Medium | XYZ-2 | Add dark mode | To Do | 8 |
```

**Detail View (formatIssueForAI):**
```markdown
## XYZ-1: Fix login bug
**Status:** In Progress | **Priority:** 🔴 High | **Points:** 5 | **Updated:** 27/03/2026

### Description
User cannot login with SSO...

### Quality Analysis
✅ Description has Given-When-Then sections
⚠️ 15 comments since last update (possible drift)

### Recent Comments
- **User1** (27/03): Tested on Chrome, works fine
- **User2** (25/03): Need LDAP support

### Next Steps
- Log work (add hours)
- Add comment about LDAP
- Transition to Code Review when done
```

### 5. Utilities Layer (utils.ts)

**Responsibility:** Error formatting, tool chaining, error handling wrapper.

```typescript
┌────────────────────────────────────┐
│ withErrorHandler<T>()              │
├────────────────────────────────────┤
│ try {                              │
│   result = await handler()         │
│   return result                    │
│ } catch (err) {                    │
│   return formatToolError(err)      │
│ }                                  │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ formatToolError(err: unknown)      │
├────────────────────────────────────┤
│ Detects error type:                │
│ • timeout → API_TIMEOUT            │
│ • 401 → AUTHENTICATION_FAILED      │
│ • 404 → ISSUE_NOT_FOUND            │
│ • other → INTERNAL_ERROR           │
│ Returns { code, message }          │
└────────────────────────────────────┘
        ↓
┌────────────────────────────────────┐
│ getChainHint(toolName)             │
├────────────────────────────────────┤
│ Looks up TOOL_CHAINING map:        │
│ 'list_my_open_issues' →            │
│   'get_issue_detail'               │
│ Returns suggestion for next action │
└────────────────────────────────────┘
```

## Data Flow: Get Issue Detail with Drift Detection

```
User: "Get issue XYZ-123"
    ↓
Claude sends: {
  name: "get_issue_detail",
  arguments: { key: "XYZ-123" }
}
    ↓
MCP Server receives request
    ↓
Tool Handler (tools.ts):
    ├─ Validate: GetIssueSchema.parse({ key: "XYZ-123" })
    ├─ Call: withErrorHandler(async () => {
    │   const issue = await jiraClient.getIssue("XYZ-123")
    │   const drift = buildQuickDriftWarning(issue)
    │   return formatIssueForAI(issue, drift)
    │ })
    └─ Handle errors: return formatToolError(err)
    ↓
JiraClient.getIssue("XYZ-123"):
    ├─ GET /rest/api/2/issue/XYZ-123
    ├─ axios call (15s timeout)
    ├─ Error interceptor checks response
    └─ Return Issue object or throw Error
    ↓
Formatter.formatIssueForAI(issue):
    ├─ Extract: summary, description, status, priority
    ├─ Drift Detection:
    │  ├─ Check issue age: created 45 days ago → +25 pts
    │  ├─ Count comments after update: 8 comments → +40 pts
    │  ├─ Check keywords: "fix" mentioned, comments after → +35 pts
    │  ├─ Total: 25 + 40 + 35 = 100 pts > 75 → WARN
    │  └─ Return: "⚠️ DRIFT DETECTED: Description may be outdated"
    ├─ Clean markup: h1 → #, *text* → **text**
    ├─ Priority emoji: "High" → "🔴 High"
    ├─ Format dates: 2026-03-27T10:30:00Z → "27/03/2026 10:30"
    ├─ Quality check: Has Given-When-Then? Yes → ✅
    └─ Return: Markdown text
    ↓
Tool Handler returns: {
  content: [{
    type: "text",
    text: "## XYZ-123: ...\n⚠️ DRIFT DETECTED: ..."
  }],
  metadata: {
    chainHint: "log_work or update_issue_status"
  }
}
    ↓
MCP Server sends response via stdout
    ↓
Claude reads markdown, displays to user
    ↓
User sees drift warning, can call log_work or updateIssueStatus next
```

## Authentication Flow

```
┌──────────────────────────────┐
│ User Setup (One-time)        │
├──────────────────────────────┤
│ 1. Create PAT in Jira Server │
│    (Settings → PAT → Create) │
│ 2. Copy token                │
│ 3. Set JIRA_PAT env var      │
│ 4. npm run build && npm start│
└──────────────────────────────┘
    ↓
┌──────────────────────────────┐
│ Request Time                 │
├──────────────────────────────┤
│ 1. Client makes request      │
│ 2. JiraClient adds header:   │
│    Authorization: Bearer $PAT│
│ 3. Jira server validates PAT │
│ 4. Returns issue data OR 401 │
│    (if token invalid)        │
└──────────────────────────────┘
```

**Error Cases:**
- Missing `JIRA_PAT` env var → Error on startup
- Invalid PAT → 401 API response → `AUTHENTICATION_FAILED` error
- PAT with insufficient permissions → 403 API response → `PERMISSION_DENIED` error

## Tool Chaining Map (UPDATED)

```
Entry point:
  list_issues
    ↓
    ├─→ get_issue_detail (see details)
    │     ↓
    │     ├─→ log_work (record hours)
    │     ├─→ update_issue (change status + comment)
    │     └─→ manage_jira_pat (update token if needed)
    │
    └─→ create_issue (report new issue)
         ↓
         └─→ get_issue_detail

Workflow:
  1. list_issues → (see what's open)
  2. get_issue_detail → (pick one issue)
  3. log_work → (record effort)
  4. update_issue → (add comment + move to Done)
```

**chainHint Values (UPDATED):**
```typescript
{
  'list_issues': 'get_issue_detail or create_issue',
  'get_issue_detail': 'log_work or update_issue or manage_jira_pat',
  'log_work': 'update_issue',
  'update_issue': 'list_issues',
  'create_issue': 'get_issue_detail',
  'manage_jira_pat': '(no chain)'
}
```

## Error Handling Architecture

```
Tool Handler
    ↓
withErrorHandler(async () => {
  ├─ Input Validation
  │  └─ ZodError → formatToolError → VALIDATION_ERROR
  │
  ├─ API Call
  │  ├─ axios timeout → formatToolError → API_TIMEOUT
  │  ├─ 401 response → formatToolError → AUTHENTICATION_FAILED
  │  ├─ 404 response → formatToolError → ISSUE_NOT_FOUND
  │  ├─ 403 response → formatToolError → PERMISSION_DENIED
  │  └─ 5xx response → formatToolError → INTERNAL_ERROR (Jira side)
  │
  └─ Logic Error
     └─ Missing field → formatToolError → INTERNAL_ERROR
})
    ↓
Tool Response
    ├─ Success: { content: [{type: "text", text: "..."}] }
    └─ Error: { code: "ERROR_CODE", message: "Description" }
```

## Remote Deployment Architecture (Optional)

```
┌────────────────────────┐
│ Local Machine          │
├────────────────────────┤
│ mcp-jira-tools Server  │
│ (stdio transport)      │
└────────┬───────────────┘
         │
         ↓ (local unix socket)
┌────────────────────────┐
│ supergateway v3.4.3    │
│ (Docker container)     │
├────────────────────────┤
│ Bridge:                │
│ stdio → Streamable HTTP│
│ (converts protocol)    │
└────────┬───────────────┘
         │
         ↓ (HTTP tunnel)
┌────────────────────────┐
│ ngrok                  │
├────────────────────────┤
│ Public URL:            │
│ https://xxxx.ngrok.io  │
└────────┬───────────────┘
         │
         ↓ (HTTPS)
┌────────────────────────┐
│ Claude Desktop/Code    │
│ (Remote MCP endpoint)  │
└────────────────────────┘
```

**Script: start-ngrok-remote.sh**
- Pulls supergateway Docker image
- Runs mcp-jira-tools in container with PAT env var
- Bridges stdio to HTTP
- Creates ngrok tunnel (public URL)
- Health checks (port 5000)
- Graceful shutdown on signal
- Outputs Claude config JSON for easy integration

## Type System Architecture

```
Zod Schemas (Runtime Validation)
    ↓
    ├─ ListIssuesSchema
    ├─ GetIssueSchema
    ├─ LogWorkSchema
    ├─ UpdateStatusSchema
    ├─ AddCommentSchema
    ├─ CreateIssueSchema
    └─ GetTransitionsSchema
    ↓
Type Inference (z.infer<typeof Schema>)
    ↓
TypeScript Types (Compile-time Checking)
    ├─ type ListIssuesInput = z.infer<typeof ListIssuesSchema>
    ├─ type Issue = Jira API response
    ├─ type ToolResponse = MCP protocol
    └─ type ToolChainHint = string
    ↓
Function Signatures
    ├─ handler(args: ListIssuesInput): Promise<ToolResponse>
    └─ formatIssueForAI(issue: Issue): string
```

## Concurrency Model

**Single-Threaded (Node.js Event Loop)**

```
                    ┌─ Request 1 (stdin)
MCP Server ←────────┤─ Request 2 (stdin)
(event loop)        └─ Request 3 (stdin)
    ├─ Parse Request 1
    ├─ Call Handler 1
    │  └─ JiraClient.searchIssues() (async)
    │     └─ axios GET request (awaiting HTTP response)
    ├─ While waiting: Handle Request 2
    │  └─ Call Handler 2
    │     └─ JiraClient.getIssue() (async)
    │        └─ axios GET request (awaiting HTTP response)
    ├─ Request 1 HTTP response arrives
    │  └─ Format output, send response (stdout)
    └─ Handle Request 3 while Request 2 still pending
```

**No parallel processing needed** (requests are I/O-bound, not CPU-bound).

## Security Architecture

```
┌──────────────────────────────────┐
│ Input Security                   │
├──────────────────────────────────┤
│ 1. Zod Schema Validation         │
│    └─ Rejects unexpected fields  │
│    └─ Validates field types      │
│                                  │
│ 2. String Sanitization           │
│    └─ No SQL injection (parameterized API)
│    └─ Jira API is REST-based    │
│       (no direct SQL)            │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ Authentication Security          │
├──────────────────────────────────┤
│ 1. PAT Bearer Token              │
│    └─ Only Server/Data Center    │
│    └─ Never in code (env var)    │
│                                  │
│ 2. HTTPS Transport               │
│    └─ axios default (if JIRA_URL|
│       is https://...)            │
│                                  │
│ 3. No Token Logging              │
│    └─ Error interceptor doesn't  │
│       log auth headers           │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ Authorization Security           │
├──────────────────────────────────┤
│ 1. Jira Server Auth              │
│    └─ Only sees issues user      │
│       has permission to access   │
│                                  │
│ 2. User Confirmation             │
│    └─ Write ops (log_work,       │
│       transition, comment,       │
│       create) require prompt     │
│       (via mcp-config.json)      │
└──────────────────────────────────┘
```

## Scalability Considerations

**Current (Single Server):**
- 1 Node.js process
- Single JiraClient instance
- Per-request timeout: 15s
- No request queuing
- Suitable for: 1-5 concurrent users

**If Scaling Needed (Future):**
- Load balancer (nginx)
- Multiple mcp-jira-tools instances
- Connection pooling (axios defaults)
- Cache layer (Redis) for frequently accessed issues
- Rate limiting (per user or API key)
- Metrics collection (prom client)

## Dependencies & External Services

```
mcp-jira-tools
├── Internal Dependencies
│   ├── src/jira/client.ts (JiraClient)
│   ├── src/jira/tools.ts (Tool Handlers)
│   ├── src/jira/formatter.ts (Output Formatting)
│   └── src/shared/utils.ts (Utilities)
│
└── External Dependencies
    ├── @modelcontextprotocol/sdk (MCP protocol)
    ├── axios (HTTP client)
    ├── zod (Schema validation)
    ├── dotenv (Env var loading)
    │
    └── External Services
        ├── Jira Server/Data Center
        │   └─ REST API v2 (HTTPS)
        │
        └── For Remote Deployment
            ├── Docker (supergateway container)
            ├── ngrok (Public tunnel)
            └── Your cloud server (EC2, GCP, etc.)
```

## Deployment Architecture Variants

### Variant 1: Claude Desktop (Local)
```
Claude Desktop
    ↓ (stdio MCP config)
mcp-jira-tools (npm start)
    ↓ (HTTPS)
Jira Server/Data Center
```

### Variant 2: Claude Code (Local)
```
Claude Code
    ↓ (stdio MCP config)
mcp-jira-tools (npm start)
    ↓ (HTTPS)
Jira Server/Data Center
```

### Variant 3: Remote (ngrok tunnel)
```
Claude Desktop / Code
    ↓ (HTTPS)
ngrok tunnel
    ↓ (HTTPS)
supergateway (Docker) + mcp-jira-tools
    ↓ (HTTPS)
Jira Server/Data Center
```

**All variants:** Same mcp-jira-tools code, only transport differs.
