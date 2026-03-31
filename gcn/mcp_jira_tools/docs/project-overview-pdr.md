# mcp-jira-tools: Project Overview & PDR

## Project Summary

**mcp-jira-tools** là MCP (Model Context Protocol) server cung cấp công cụ Jira cho Claude AI assistants. Cho phép Claude tương tác trực tiếp với Jira Server/Data Center để quản lý issues, log work, comment, và transition issues.

**Version:** v1.0.0
**Status:** Production-ready
**Primary User:** Vietnamese dev teams sử dụng Jira Server/Data Center

## Purpose & Use Cases

**Core Purpose:** Giúp Claude AI (Claude Desktop, Claude Code) tích hợp Jira workflow vào conversation tự nhiên.

**Use Cases:**
1. Lấy danh sách open issues của user (JQL query)
2. Xem chi tiết issue (description, comments, attachments)
3. Log work (ghi nhận giờ làm việc)
4. Transition issue (chuyển status: To Do → In Progress → Done)
5. Thêm comment vào issue
6. Tạo issue mới từ conversation
7. Kiểm tra drift (khi issue description có thể lỗi thời so với comments)

## Target Audience

- **Developers:** Tương tác Jira mà không cần rời session Claude
- **Team Leads:** Monitor, update issue status, assign work
- **Vietnamese Teams:** UI/descriptions toàn Vietnamese
- **Jira Server/Data Center Users:** NOT Jira Cloud (uses PAT Bearer auth)

## Architecture

```
Claude Desktop / Claude Code
        ↓ (MCP protocol via stdio)
mcp-jira-tools Server (Node.js/TypeScript)
        ├── 6 Tools: list_issues, get_issue_detail, log_work, update_issue, create_issue, manage_jira_pat
        ├── JiraClient: Jira REST API v2 (axios + PAT auth) + fuzzy matching
        ├── PATManager: PAT runtime updates (no restart needed)
        ├── Formatter: Markdown output for AI comprehension
        └── Error Handler: Safety validation + confirmation flow
        ↓
Jira Server/Data Center (REST API v2)
```

## Product Requirements

### Functional Requirements (FRs)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR1 | List user's open issues (JQL) | MUST | ✅ |
| FR2 | Get issue details (description, comments, fields) | MUST | ✅ |
| FR3 | Log work on issue (add hours) | MUST | ✅ |
| FR4 | Transition issue (change status) | MUST | ✅ |
| FR5 | Add comment to issue | MUST | ✅ |
| FR6 | Create new issue | MUST | ✅ |
| FR7 | Detect issue drift (stale descriptions) | SHOULD | ✅ |
| FR8 | Tool chaining (suggest next action) | SHOULD | ✅ |

### Non-Functional Requirements (NFRs)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NFR1 | Response time < 3s for list/read (excl. Jira API) | SHOULD | ✅ |
| NFR2 | PAT Bearer auth (not OAuth) | MUST | ✅ |
| NFR3 | Jira Server/Data Center support | MUST | ✅ |
| NFR4 | Vietnamese descriptions for tools | MUST | ✅ |
| NFR5 | Write operations require confirmation | MUST | ✅ |
| NFR6 | Markdown output (AI-friendly) | MUST | ✅ |
| NFR7 | Remote deployment (ngrok) support | SHOULD | ✅ |
| NFR8 | MCP Inspector compatibility | SHOULD | ✅ |

### Acceptance Criteria

- ✅ All 6 core tools callable from Claude Desktop/Code
  - list_issues (search + filter)
  - get_issue_detail (view issue + drift detection)
  - log_work (record hours)
  - update_issue (transition + comment)
  - create_issue (with fuzzy field matching)
  - manage_jira_pat (PAT viewer/updater)
- ✅ Jira responses formatted as markdown (readable for AI)
- ✅ Write operations require user confirmation (CLI prompts)
- ✅ Drift detection warns when issue outdated
- ✅ Tool chaining suggests next logical tool after each action
- ✅ Error messages clear (API errors, auth failure, validation)
- ✅ Remote deployment script (ngrok tunnel) works end-to-end
- ✅ No hardcoded secrets in code (env vars only)
- ✅ Fuzzy field matching for create_issue (spda, congDoan, assignee, epic)

## Technical Constraints

- **Jira Version:** Server/Data Center (v7.x+). NOT Jira Cloud
- **Auth:** PAT (Personal Access Token) Bearer auth only
- **Transport:** stdio (Claude Desktop) or remote (supergateway + ngrok)
- **Node Version:** 18+ (ES2022, NodeNext modules)
- **Timeout:** 15s API call timeout
- **Rate Limiting:** Per Jira instance policy (no client-side limiting)

## Key Features & Differentiators

1. **Vietnamese Descriptions:** Tools described in Vietnamese — optimized for Vietnamese teams
2. **Drift Detection:** Heuristic warning when issue description may be stale (based on age + comment count)
3. **Description Quality Analysis:** Checks for Given-When-Then (GWT) sections in issue descriptions
4. **Tool Chaining:** Each tool output includes `chainHint` suggesting next tool to use
5. **Safety-First Design:** Write operations (log work, transition, comment, create) require user confirmation via CLI prompt
6. **MCP Inspector Support:** Debug tools and schema validation with MCP Inspector
7. **Remote Deployment:** start-ngrok-remote.sh for production deployment via supergateway + ngrok tunnel

## Configuration

### Environment Variables

```bash
JIRA_BASE_URL=https://jira.company.com  # Jira Server/Data Center URL
JIRA_PAT=...                             # Personal Access Token (Bearer auth)
JIRA_DEFAULT_PROJECT=XYZ                 # Default project key (optional)
```

### mcp-config.json (UPDATED)

Safety configuration defining which tools require user confirmation:

```json
{
  "tools": {
    "requireConfirmation": ["log_work", "update_issue", "create_issue", "manage_jira_pat"]
  }
}
```

**Changes:** `update_issue_status` + `add_comment` merged → `update_issue`. Added `manage_jira_pat` for PAT updates.

## Dependencies

**Production:**
- @modelcontextprotocol/sdk ^1.0.0 — MCP protocol implementation
- axios ^1.7.0 — HTTP client for Jira API
- zod ^3.23.0 — Schema validation
- dotenv ^16.4.0 — Environment variable loading

**Development:**
- tsx ^4.x — TypeScript runner
- typescript ^5.x — Language
- @types/node ^20.x — Node.js types

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|---|
| Tool Availability | 100% | All 6 tools callable, no timeout errors |
| Response Time (API) | <3s (excl. Jira) | Latency measured via logs |
| User Confirmation | 100% on writes | All write operations prompt user |
| Error Recovery | 95%+ | Graceful errors, clear messages |
| Documentation | 100% | All tools documented in README + PDR |
| Drift Detection | >90% accuracy | Heuristic scoring validated with QA |

## Roadmap (Future)

- [ ] Jira Cloud support (OAuth flow)
- [ ] Issue search with advanced filters (JQL builder UI)
- [ ] Bulk operations (transition multiple issues)
- [⚒️] Custom field support (PARTIALLY DONE: hardcoded fields + fuzzy resolve fallback)
- [ ] Dynamic custom field schema (metadata from Jira createmeta)
- [ ] Webhook notifications (issue updates → Claude)
- [ ] Performance dashboard (API call metrics, response times)

## Security & Compliance

- **Auth:** PAT Bearer token stored in `.env.local` (never committed)
- **Secrets:** Encrypted in env, not logged
- **Input Validation:** Zod schema validation on all tool inputs
- **API Limits:** Respects Jira API rate limits (no client-side retry flooding)
- **SSRF Protection:** Validates JIRA_BASE_URL is authorized domain (implicit — single source)

## Documentation

| File | Purpose |
|---|---|
| README.md | Quick start, setup, tool reference |
| codebase-summary.md | File-by-file breakdown, data flow |
| code-standards.md | Naming, patterns, conventions |
| system-architecture.md | MCP protocol, Jira integration flow |

## Contact & Support

- **Maintainer:** GoClaw team
- **Report Issues:** GitHub issues or internal Slack
- **Questions:** DM team lead
