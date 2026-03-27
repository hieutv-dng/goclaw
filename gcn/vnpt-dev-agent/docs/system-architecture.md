# System Architecture — vnpt-dev-agent

Tài liệu này mô tả kiến trúc hệ thống và thiết kế các thành phần chính của MCP server.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Desktop / IDE                      │
│                (MCP Client - uses tools)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                    StdioServerTransport
                    (stdin/stdout)
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  MCP Server (index.ts)                        │
│         - McpServer instance                                  │
│         - Tool & Resource registration                        │
│         - Prompt definitions                                  │
└────────────┬────────────┬────────────┬───────────────────────┘
             │            │            │
      ┌──────▼─┐   ┌──────▼──┐   ┌────▼──────┐
      │ Tools  │   │Resources│   │ Prompts   │
      │(60+)   │   │(3)      │   │(workflows)│
      └────────┘   └─────────┘   └───────────┘
             │            │
      ┌──────┴─────────────┴──────┬──────────────┐
      │                          │              │
   ┌──▼───────┐    ┌────────────▼──┐   ┌──────▼─────┐
   │Jira API  │    │Local FS Files  │   │Config JSON │
   │(axios)   │    │(markdown, ts)  │   │(mcp-config)│
   └──────────┘    └─────────────────┘   └────────────┘
```

## Core Components

### 1. MCP Server (index.ts)
**Bộ não** của hệ thống:
- Khởi tạo `McpServer` instance
- Đăng ký 60+ tools từ 28 modules
- Đăng ký 3 resources (TEAM_CONTEXT.md, GIT_STANDARD.md, mcp-config.json)
- Đăng ký prompts (workflows)
- Nghe trên stdio, gửi response qua stdout

**Key Flow:**
```
1. dotenv/config loaded (load .env)
2. McpServer initialized
3. All module register functions called
4. server.connect() — listen on stdio
```

### 2. Tool Layer (28 modules)

Mỗi module cung cấp 1-7 tools qua `registerXxxTools(server)` function.

**Tổ chức:**
```
Core (3)       → Jira, Codebase, Evaluator
Context (2)    → Team Context, Git Standard
Quality (5)    → GWT, Security, Drift, Feedback, Metrics
Parsing (4)    → Parser, Logwork, Kickoff, Quality Gate
Code Gen (4)   → Template, PR Generator, Impact Analysis, Estimation
Session (4)    → Session, Docs Discovery, Knowledge, Plugins
Infra (2)      → Stack Profiles, Shared Utils
```

### 3. Jira Integration (jira/)

**Components:**
- **client.ts** — Axios-based REST client
  - Methods: GET /rest/api/3/issues, POST /rest/api/3/issues/{key}/worklog, etc.
  - Auth: Bearer token (JIRA_PAT env var)
  - Endpoints cố định trong code

- **formatter.ts** — Response formatting
  - Chuyển Jira response → readable text/JSON

- **tools.ts** — 7 MCP tools
  - list_my_open_issues, get_issue_detail, log_work, update_issue_status, get_available_transitions, add_comment, create_issue

**Key Security:**
- log_work, update_issue_status, create_issue yêu cầu user confirmation
- Tokens không bao giờ log (handled in withErrorHandler)

### 4. Codebase Analysis (codebase/)

**Components:**
- **reader.ts** — CodebaseReader class
  - Quét files per stack profile
  - Hỗ trợ 6 frameworks (Angular, React, NestJS, Spring, Flutter, Generic)
  - Respect maxFileSizeKb, recentFileWindowMinutes from config

- **scorer.ts** — SmartScorer class
  - Multi-signal ranking:
    1. TF-IDF từ description
    2. File name relevance
    3. Recency (modified time)
    4. Framework affinity
  - Returns top K files (default 5)

- **tools.ts** — 5 MCP tools
  - find_by_name, search_keyword, read_module, detect_files_from_task, rank_context_files

**Workflow:**
```
detect_files_from_task(description)
  → identify stack (auto or config)
  → CodebaseReader.scan()
  → SmartScorer.rank()
  → return top K files with scores
```

### 5. Configuration Layer

**Files:**
- **mcp-config.json** — Server defaults
  ```json
  {
    "defaults": {
      "stack": "auto",
      "topK": 5,
      "recentFileWindowMinutes": 480,
      "maxFileSizeKb": 50
    },
    "paths": {
      "teamContext": "TEAM_CONTEXT.md",
      "gitStandard": ["GIT_STANDARD.md", "docs/GIT_STANDARD.md"],
      "securityPatterns": "SECURITY_PATTERNS.md"
    }
  }
  ```

- **.env** — Sensitive data
  ```
  JIRA_BASE_URL=https://jira.example.com
  JIRA_PAT=xxx-token-xxx
  JIRA_DEFAULT_PROJECT=PROJ
  ```

- **TEAM_CONTEXT.md** — Tribal knowledge (read via MCP resource)
- **GIT_STANDARD.md** — Git workflow standards
- **SECURITY_PATTERNS.md** — Security requirements

### 6. Data Storage Layer

**In-memory (current session):**
- Session context (save_session, load_session, list_sessions)
- Cached configs

**Persistent (local files):**
- **.vnpt-dev-agent/feedback-store.json** — Task feedback history
- **.vnpt-dev-agent/metrics-store.json** — Metrics & performance data

**Format:** JSON with timestamps

### 7. Error Handling (shared/index.ts)

`withErrorHandler()` wrapper:
```typescript
withErrorHandler(async (input) => {
  // implementation
})
```

**Responsibility:**
- Catch all errors (sync & async)
- Format error response for MCP client
- Log to stderr (safe for MCP protocol)
- Return consistent error structure

### 8. Stack Profile Resolution (stack-profiles/)

**Components:**
- **profiles.ts** — 6 presets
  - Angular, React, NestJS, Spring, Flutter, Generic
  - Định nghĩa file patterns, component naming, etc.

- **resolver.ts** — Auto-detect
  - Quét marker files (angular.json, package.json, pom.xml, pubspec.yaml)
  - Return detected stack or "auto"

**Usage:**
```typescript
const stack = resolveStack(".") // returns "react", "nest", etc.
const profile = STACK_PROFILES[stack] // get config
```

## Data Flow — Task Kickoff to Completion

### Phase 1: Task Entry (kick-off)
```
task_kickoff(issueKey)
  → get_issue_detail(issueKey) via Jira client
  → parse description
  → return issue summary + description
```

### Phase 2: Context Gathering
```
get_team_context()
  → read TEAM_CONTEXT.md
  → filter by sections
  → return tribal knowledge

check_security_flag()
  → read SECURITY_PATTERNS.md
  → identify security domains
  → return checklist
```

### Phase 3: Task Analysis
```
evaluate_task_complexity(description)
  → NLP scoring:
    - clarity (0-100)
    - complexity (0-100)
    - AI risk (low/medium/high)
  → return missing info, estimated hours, subtasks
```

### Phase 4: Code Discovery
```
detect_files_from_task(description)
  → resolveStack()
  → CodebaseReader.scan()
  → SmartScorer.rank()
  → return top 5 files with relevance scores
```

### Phase 5: Quality Gates (Pre-Implementation)
```
check_description_drift()
  → compare Jira description vs comments
  → identify if requirements changed
  → warn if outdated

check_description_quality()
  → GWT validation
  → format compliance (A-F grade)
  → return suggestions
```

### Phase 6: Implementation (Claude's Job)
Code generation happens in Claude context (not in MCP tools).

### Phase 7: Post-Implementation Quality
```
check_quality_gate()
  → lint/build/test status
  → return pass/fail with details

generate_pr_description()
  → template-based from task + code changes
  → return markdown

generate_worklog()
  → template-based
  → return formatted time entry
```

### Phase 8: Completion
```
submit_task_feedback(issueKey, feedback)
  → save to feedback-store.json
  → track quality metrics

track_metric(name, value)
  → save to metrics-store.json
  → aggregatable for insights

save_session(sessionData)
  → local session storage
  → load in future sessions
```

## Resource Layer (MCP Resources)

Three static resources (AI can read anytime):

1. **memory://team-context**
   - File: TEAM_CONTEXT.md
   - Type: text/markdown

2. **memory://git-standard**
   - File: GIT_STANDARD.md
   - Type: text/markdown

3. **memory://mcp-config**
   - File: mcp-config.json
   - Type: application/json

## Prompt Layer (MCP Prompts)

Predefined workflows (in prompts/index.ts):
- `start` — Task kickoff workflow
- `implement-task` — Given issue key, implement
- `review-code` — Code review by standards
- `close-task` — Log work and complete
- Custom per project (loaded via plugins)

## Plugin System (plugins/loader.ts)

**Purpose:** Extend tools & prompts per project

**API:**
```typescript
loadProjectPlugins(projectPath)
  → scan .vnpt-dev-agent/plugins/
  → load .js/.ts files
  → call registerXxx() from each plugin
```

**Use Case:**
- Add project-specific tools
- Override default prompts
- Custom stack profiles

## Dependency Graph

```
index.ts
  ├── jira/tools
  ├── codebase/tools
  │   ├── codebase/reader
  │   └── codebase/scorer
  ├── evaluator/tools
  ├── team-context/tools
  ├── git-standard/tools
  ├── gwt/tools
  ├── security/tools
  ├── drift/tools
  ├── feedback/tools
  ├── metric-stores/tools
  ├── parser/tools
  ├── gen-logwork/tools
  ├── kick-off/tools
  ├── quality-gate/tools
  ├── pr-generator/tools
  ├── session/tools
  ├── template-gen/tools
  ├── impact-analysis/tools
  ├── metrics/estimation
  ├── knowledge/sharing
  ├── docs-discovery/tools
  ├── plugins/loader
  ├── resources/index
  ├── prompts/index
  ├── stack-profiles/
  │   ├── profiles
  │   └── resolver
  └── shared/
      ├── index (withErrorHandler, getChainHint)
      └── utils
```

## Error Propagation

```
Tool execution error
  → caught by withErrorHandler()
  → formatted as MCP error response
  → logged to stderr
  → returned to Claude

User confirmation required
  → tool throws ConfirmationRequiredError
  → MCP client (Claude) receives error
  → Claude prompts user
  → user approves/rejects
  → tool retried or cancelled
```

## Scalability Considerations

### Current Limits
- Jira API: Rate limited by Atlassian (depends on license)
- File scanning: Limited by maxFileSizeKb (50 KB default)
- Search results: Limited by topK (5 default)
- Recent files: 480 minute window (8 hours)

### Optimization Opportunities
1. Cache Jira issue details per session
2. Index codebase on startup (instead of scan-on-demand)
3. Implement pagination for large result sets
4. Parallel API calls for batch operations

### Multi-tenancy
Not supported (single Jira instance per server).
To support multiple Jira instances:
- Modify client.ts to accept baseUrl per call
- Store multiple API tokens
- Pass tenant context through all tools

## Security Architecture

### Authentication
- **Jira:** Bearer token (JIRA_PAT environment variable)
- **Local files:** Read-only access to project files
- **No auth for local MCP resources** (trusted environment)

### Data Isolation
- No cross-project data mixing (single instance)
- Feedback/metrics stored locally (not centralized)
- Session data ephemeral (cleared per session)

### Input Validation
- All tool inputs validated via Zod schemas
- File paths validated (no directory traversal)
- Jira keys validated (standard format check)

## Testing Strategy

Currently no test framework configured, but recommended:

```
Unit Tests
  ├── codebase/scorer.ts (ranking algorithm)
  ├── jira/formatter.ts (response formatting)
  ├── metrics/estimation.ts (calculation logic)
  └── shared/utils.ts (helper functions)

Integration Tests
  ├── jira/tools (mock Jira API)
  ├── codebase/tools (test with sample repo)
  └── feedback/tools (storage & retrieval)

E2E Tests
  └── Full workflow: kickoff → complete
```

## Monitoring & Observability

**Logging:** stderr via console.error() in withErrorHandler()
**Metrics:** Stored in metrics-store.json
**Feedback:** Stored in feedback-store.json

**Future:** Add OpenTelemetry for distributed tracing
