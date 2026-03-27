# Codebase Summary — vnpt-dev-agent

Tài liệu này cung cấp tổng quan về cấu trúc và tổ chức mã nguồn của dự án **vnpt-dev-agent**.

## Tổng quan dự án

**vnpt-dev-agent** là một MCP (Model Context Protocol) server tích hợp với Jira, được phát triển bằng TypeScript. Nó cung cấp **60+ công cụ MCP** để tự động hóa quy trình phát triển phần mềm — từ quản lý tác vụ Jira, phân tích mã, kiểm tra bảo mật đến tự động tạo logwork.

- **Runtime:** Node.js, ESM modules
- **Ngôn ngữ:** TypeScript 5.6 (strict mode)
- **Build:** tsc → dist/
- **Dev:** tsx watch
- **Transport:** StdioServerTransport (stdin/stdout)

## Cấu trúc thư mục chính

```
src/
├── index.ts                    # Entry point MCP server
├── codebase/                   # Code discovery (5 tools)
│   ├── reader.ts               # CodebaseReader - quét file theo stack profiles
│   ├── scorer.ts               # SmartScorer - xếp hạng file theo tín hiệu ngữ nghĩa
│   └── tools.ts                # Tool definitions
├── docs-discovery/tools.ts     # Quét docs dự án tự động
├── drift/tools.ts              # Phát hiện lệch require drift
├── evaluator/tools.ts          # Phân tích độ phức tạp task
├── feedback/tools.ts           # Vòng lặp học hỏi (3 tools)
├── gen-logwork/tools.ts        # Tự động tạo logwork
├── git-standard/tools.ts       # Chuẩn Git (3 tools)
├── gwt/tools.ts                # Given-When-Then validation
├── impact-analysis/tools.ts    # Phân tích ảnh hưởng dependencies
├── jira/                       # Trung tâm tích hợp Jira
│   ├── client.ts               # Jira REST client (axios)
│   ├── formatter.ts            # Định dạng response
│   └── tools.ts                # 7 Jira tools
├── kick-off/tools.ts           # Task entry point
├── knowledge/sharing.ts        # Chia sẻ kiến thức cross-project
├── metric-stores/tools.ts      # Tracking metrics (3 tools)
├── metrics/estimation.ts       # Dự đoán effort
├── parser/tools.ts             # Parse description (2 tools)
├── plugins/loader.ts           # Plugin system
├── pr-generator/tools.ts       # Auto-fill PR description
├── prompts/index.ts            # MCP prompts (workflows)
├── quality-gate/tools.ts       # Pre-ship checks
├── resources/index.ts          # MCP resources registration
├── security/tools.ts           # Security checks (2 tools)
├── session/tools.ts            # Session memory (3 tools)
├── shared/                     # Utilities
│   ├── index.ts                # withErrorHandler, getChainHint
│   └── utils.ts                # Helper functions
├── stack-profiles/             # Multi-framework support
│   ├── index.ts                # Barrel export
│   ├── profiles.ts             # 6 stack presets
│   └── resolver.ts             # Auto-detect từ marker files
└── team-context/tools.ts       # Tribal knowledge (2 tools)
```

## 28 Modules với 60+ Tools

### Nhóm Core (3 modules)

1. **jira/** - 7 tools
   - list_my_open_issues, get_issue_detail, log_work, update_issue_status, get_available_transitions, add_comment, create_issue
   - Yêu cầu confirmation trước mọi mutation

2. **codebase/** - 5 tools
   - find_by_name, search_keyword, read_module, detect_files_from_task, rank_context_files
   - Hỗ trợ 6 stack: Angular, React, NestJS, Spring, Flutter, Generic

3. **evaluator/** - 1 tool
   - evaluate_task_complexity: Phân tích clarity, complexity, AI risk, estimated hours, subtasks

### Nhóm Context & Standards (2 modules)

4. **team-context/** - 2 tools
   - get_team_context, update_team_context
   - Quản lý tribal knowledge (SERVICE_RULES, API_GOTCHAS, FORBIDDEN_PATTERNS, v.v.)

5. **git-standard/** - 3 tools
   - get_git_standard, suggest_branch_name, suggest_commit_message
   - Tích hợp Conventional Commits

### Nhóm Quality (5 modules)

6. **gwt/** - 2 tools: generate_gwt_description, validate_description_quality
7. **security/** - 2 tools: check_security_flag, security_review_checklist (7 domains)
8. **drift/** - 2 tools: check_description_drift, extract_latest_requirements
9. **feedback/** - 3 tools: submit_task_feedback, get_feedback_insights, list_feedback_history
10. **metric-stores/** - 3 tools: track_metric, get_metrics_report, get_metrics_dashboard

### Nhóm Parsing (4 modules)

11. **parser/** - 2 tools: parse_description, check_format_compliance
12. **gen-logwork/** - 1 tool: generate_worklog
13. **kick-off/** - 1 tool: task_kickoff
14. **quality-gate/** - 1 tool: check_quality_gate

### Nhóm Code Generation (4 modules)

15. **template-gen/** - 1 tool: generate_template
16. **pr-generator/** - 1 tool: generate_pr_description
17. **impact-analysis/** - 1 tool: analyze_impact
18. **metrics/estimation.ts** - 1 tool: suggest_estimation

### Nhóm Session (4 modules)

19. **session/** - 3 tools: save_session, load_session, list_sessions
20. **docs-discovery/** - 2 tools: scan_project_docs, read_project_doc
21. **knowledge/** - 2 tools: contribute_knowledge, get_shared_knowledge
22. **plugins/** - 1 tool: reload_plugins (+ loadProjectPlugins())

### Nhóm Infra (2 modules)

23. **stack-profiles/** - Auto-detect framework từ marker files
24. **shared/** - withErrorHandler, getChainHint, utilities
25. **resources/** - MCP resources (TEAM_CONTEXT.md, GIT_STANDARD.md, mcp-config.json)
26. **prompts/** - MCP prompts (predefined workflows)
27. **index.ts** - Server registration point
28. **jira/client.ts** - Axios-based Jira REST client

## Mẫu thiết kế chính

### 1. Stack Profiles (Multi-framework)
Hỗ trợ auto-detect 6 framework:
- **Angular:** src/app/\*.ts, angular.json
- **React:** src/components/\*.tsx, package.json (react)
- **NestJS:** src/\*.controller.ts, src/\*.service.ts
- **Spring:** src/main/java/\*Controller.java, pom.xml
- **Flutter:** lib/\*.dart, pubspec.yaml
- **Generic:** Fallback cho các framework khác

### 2. SmartScorer (Xếp hạng file)
Multi-signal ranking:
- Mã từ description (TF-IDF)
- Tên file
- Recency (modified time)
- Framework affinity

### 3. Error Handling
`withErrorHandler()` wrapper:
```typescript
export const tool = (server: McpServer) =>
  server.tool("name", schema, withErrorHandler(async (input) => {
    // implementation
  }));
```

### 4. Configuration
- **mcp-config.json:** Cấu hình mặc định (stack, topK, paths, safety)
- **.env:** JIRA_BASE_URL, JIRA_PAT, JIRA_DEFAULT_PROJECT
- **.vnpt-dev-agent/:** sessions, feedback-store.json, metrics-store.json

## Quy trình workflow chính

```
task_kickoff
  → get_team_context
  → check_security_flag
  → check_description_drift
  → detect_files_from_task
  → evaluate_task_complexity
  → [IMPLEMENTATION]
  → check_quality_gate
  → generate_pr_description
  → generate_worklog
  → submit_task_feedback + track_metric
  → save_session
```

## Dependencies chính

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "axios": "^1.7.0",
  "dotenv": "^16.4.0",
  "zod": "^3.23.0"
}
```

## Key Principles

1. **Data provider, not decision maker** — Tools trả về raw data + prompts cho Claude phân tích
2. **Full automation** — Từ task intake đến logwork
3. **Learning loop** — Feedback + metrics cải thiện theo thời gian
4. **Security-first** — 7 domains, auto-detect, checklist
5. **Drift detection** — Cảnh báo khi Jira description lỗi thời
6. **Format compliance** — Auto-grade descriptions (A-F)
7. **Multi-framework** — 6 stack presets + generic fallback

## File kích thước lớn (Top 5)

1. src/metric-stores/tools.ts (6.6%)
2. src/codebase/tools.ts (5.7%)
3. src/feedback/tools.ts (4.8%)
4. src/stack-profiles/profiles.ts (4.7%)
5. src/parser/tools.ts (4.3%)

## Tài liệu tham khảo

- **Project Setup:** docs/PROJECT_SETUP.md
- **Quickstart:** docs/QUICKSTART.md
- **Git Standards:** docs/GIT_STANDARD.md
- **Security Patterns:** docs/SECURITY_PATTERNS.md
- **Description Templates:** docs/DESCRIPTION_TEMPLATES.md
- **GWT Guide:** docs/GWT_TEMPLATE_GUIDE.md
- **Team Context:** docs/TEAM_CONTEXT.md
