# Project Overview & PDR — vnpt-dev-agent

Tài liệu này cung cấp tổng quan dự án, định hướng sản phẩm, và yêu cầu phát triển (Product Development Requirements).

## Executive Summary

**vnpt-dev-agent** là một MCP (Model Context Protocol) server tích hợp với Jira, được thiết kế để **tự động hóa toàn bộ quy trình phát triển phần mềm** cho các đội lập trình viên tại VNPT.

### Problem Statement
Các nhóm phát triển phần mềm thường gặp phải:
- Nhiều tác vụ lặp đi lặp lại: quét tài liệu, phân tích mã, tạo logwork
- Thiếu tiêu chuẩn nhất quán khi code, không tuân theo best practices
- Khó khăn trong việc chia sẻ kiến thức tribal knowledge (ngầm định)
- Không có cách để AI tự động giúp từ task intake tới completion

### Solution
**vnpt-dev-agent** cung cấp **60+ MCP tools** tích hợp với Jira, cho phép Claude AI:
1. Tự động phát hiện tác vụ Jira
2. Phân tích độ phức tạp, yêu cầu, và rủi ro
3. Quét codebase thông minh (multi-framework)
4. Kiểm tra bảo mật, chuẩn chất lượng
5. Tự động tạo logwork, PR description
6. Học hỏi từ feedback (vòng lặp cải thiện)

### Target Users
- Lập trình viên: Nhận hỗ trợ từ AI trong quá trình code
- Tech Lead: Đảm bảo chuẩn chất lượng, theo dõi metrics
- DevOps/QA: Kiểm tra quality gates, bảo mật

## Product Goals

### Primary Goals (Must Have)
1. ✅ **Jira Integration** — List/read/update issues, log work
2. ✅ **Code Discovery** — Find files per framework (6 stacks)
3. ✅ **Task Analysis** — Evaluate complexity, clarity, risks
4. ✅ **Quality Gates** — Security checks, GWT validation, pre-commit checks
5. ✅ **Learning Loop** — Feedback submission, metrics tracking
6. ✅ **Session Memory** — Save/load context across sessions

### Secondary Goals (Nice to Have)
- Plugin system for project-specific tools
- Drift detection (outdated requirements)
- Tribal knowledge management (team context)
- Auto PR generation
- Impact analysis (dependency graph)

### Achieved Goals
- All primary + most secondary goals implemented (v1.0.0)

## Functional Requirements

### 1. Jira Integration (Core)
**Requirement:** Tools must interact with Jira REST API v3

**Functions:**
- List user's open/active/done issues with filtering
- Get full issue detail including comments + subtasks
- Log work (time tracking) — requires confirmation
- Update issue status with resolution
- Get available transitions for current status
- Add comments to issues
- Create new issues/subtasks

**Acceptance Criteria:**
- All operations use JIRA_PAT token (no password)
- Mutations require user confirmation (safety)
- Errors handled gracefully (rate limits, 404s)
- Responses formatted readable for AI

### 2. Codebase Analysis
**Requirement:** Tools must intelligently locate relevant files per task

**Functions:**
- Find files by name/class/component name
- Full-text search across codebase
- Read entire folder/module contents
- Detect context files from task description (AI-powered)
- Rank files by relevance (multi-signal scoring)

**Acceptance Criteria:**
- Support 6 frameworks: Angular, React, NestJS, Spring, Flutter, Generic
- Auto-detect stack from marker files
- Respect maxFileSizeKb, recentFileWindowMinutes limits
- Return results sorted by relevance score
- SmartScorer uses 4 signals: TF-IDF, filename, recency, framework

### 3. Task Evaluation
**Requirement:** Assess task clarity, complexity, and risks before implementation

**Function:** evaluate_task_complexity(description)

**Output:**
- Clarity score (0-100)
- Complexity score (0-100)
- AI Risk level (low/medium/high)
- Missing information list
- Estimated hours
- Suggested subtasks

**Acceptance Criteria:**
- NLP-based scoring (no ML model needed)
- Accurate within ±20% for estimation
- Identify common missing info patterns
- Return actionable improvement suggestions

### 4. Quality & Security
**Requirement:** Enforce code quality standards and security requirements

**Functions:**
- Validate description format (GWT: Given-When-Then)
- Check security flag against SECURITY_PATTERNS.md
- Detect requirement drift (description vs comments)
- Run pre-ship quality gate (lint/build/test status)
- Provide security review checklist

**Acceptance Criteria:**
- GWT grade: A-F based on completeness
- Security: 7 domains (auth, data, crypto, API, input, error, logging)
- Drift: Compare description age vs recent comments
- Quality gate: Pass/fail with specific failures

### 5. Learning Loop
**Requirement:** Track quality metrics and learn from feedback

**Functions:**
- Submit task feedback (time accuracy, complexity accuracy, etc.)
- Query feedback insights (trends, patterns)
- List feedback history per project/week
- Track custom metrics (estimation accuracy, security issues found)
- Generate metrics report & dashboard

**Acceptance Criteria:**
- Feedback stored persistently (feedback-store.json)
- Metrics aggregatable by time period, stack, complexity
- Insights show trends (improving/declining accuracy)
- Dashboard suitable for team reviews

### 6. Session Management
**Requirement:** Persist context across chat sessions

**Functions:**
- Save session data (task context, files, analysis)
- Load session by ID or list recent sessions
- Cross-session state (no need to re-analyze)

**Acceptance Criteria:**
- Sessions stored locally (.vnpt-dev-agent/sessions/)
- Include metadata: task key, start time, analyzed files
- Quick resume: load session → skip re-analysis

### 7. Tribal Knowledge
**Requirement:** Centralize team practices and conventions

**Functions:**
- Read team context (TEAM_CONTEXT.md sections)
- Update team context with new patterns/gotchas
- Auto-discovery of project docs

**Sections:**
- SERVICE_RULES, API_GOTCHAS, FORBIDDEN_PATTERNS
- PREFERRED_PATTERNS, NAMING_CONVENTIONS, KNOWN_ISSUES
- TEMPORARY_WORKAROUNDS, SECURITY_RULES, TESTING_RULES, DEPENDENCIES

**Acceptance Criteria:**
- Structured sections, easy to parse
- Update operations require confirmation
- Auto-discovery scans docs/ and .gemini/ directories
- Prioritize docs: critical → helpful → reference

## Non-Functional Requirements

### Performance
- Jira API calls: < 2s (includes network latency)
- File scanning: < 1s (default 480 min window)
- Scoring 100 files: < 500ms
- SmartScorer top-K: O(n log K) complexity

### Reliability
- No data loss: feedback/metrics persisted to disk
- Graceful degradation: Missing files don't crash
- Retry logic: Handle Jira API rate limits
- Error clarity: All errors include actionable advice

### Maintainability
- 28 modules, 60+ tools organized logically
- Code standards enforced (TypeScript strict, Zod schemas)
- Plugin system for extensibility
- Clear separation: tools, infrastructure, utilities

### Security
- No secrets in code (env vars only)
- Input validation via Zod
- API token never logged or exposed
- Read-only access to local files

### Scalability (Single Instance)
- Support projects with 1000+ files
- Cache frequently accessed data
- Lazy load resources (on-demand)
- Batch Jira API calls when possible

## Architecture Decisions

### Decision 1: MCP Protocol
**Choice:** Use Model Context Protocol (vs custom REST API)
**Rationale:**
- Claude native support (no extra setup)
- No server deployment needed (stdio only)
- Easy integration with Claude Desktop / IDE
- Standard interface for LLM tool interaction

### Decision 2: TypeScript + Node.js
**Choice:** Node.js with TypeScript (vs Python/Go)
**Rationale:**
- Async/await for I/O-heavy operations (Jira API, file scanning)
- Strong type safety (zod + ts strict)
- ESM modules (modern JS standard)
- Lightweight runtime, fast startup

### Decision 3: No ORM for Jira
**Choice:** Raw axios HTTP (vs jira-client npm package)
**Rationale:**
- Minimal dependencies
- Full control over API calls
- Cache locally when needed
- Jira REST API is straightforward

### Decision 4: Multi-Signal Scoring
**Choice:** TF-IDF + recency + framework affinity (vs ML model)
**Rationale:**
- No training data needed
- Explainable results (users understand why file ranked high)
- Fast computation
- Works across any codebase

### Decision 5: Plugin System
**Choice:** Dynamic require from .vnpt-dev-agent/plugins/
**Rationale:**
- Project-specific tools without modifying core
- Easy deployment (drop .js/.ts file)
- Reload on demand
- Plugins follow same tool registration pattern

## Success Metrics

### Adoption Metrics
- Number of teams using the agent
- Number of tasks completed via agent
- Usage frequency (tasks per week per team)

### Quality Metrics
- Feedback: Estimation accuracy (±20%)
- Feedback: Complexity assessment accuracy
- Code quality: Security issues detected / false positives
- Drift: Requirements outdated / updated ratio

### Developer Experience
- Time saved per task (vs manual kickoff + logwork)
- Satisfaction score (1-5 survey)
- Feature requests / bug reports (trend)

### System Health
- Tool success rate (% requests with no errors)
- Jira API availability
- Local file I/O reliability

## Roadmap

### Phase 1: Core Tools (✅ Done)
- Jira integration (7 tools)
- Codebase discovery (5 tools)
- Basic evaluation

### Phase 2: Quality & Standards (✅ Done)
- Security checks
- GWT validation
- Git standards
- Team context

### Phase 3: Learning Loop (✅ Done)
- Feedback submission
- Metrics tracking
- Insights & dashboard

### Phase 4: Extensions (⚙️ In Progress)
- Plugin system
- Impact analysis
- Knowledge sharing

### Phase 5: Future
- Dashboard UI (web)
- Integration with Slack/Teams notifications
- Automated reporting
- Multi-language support beyond VI/EN/ZH

## Constraints & Assumptions

### Constraints
- Single Jira instance per server (no multi-tenancy)
- Local file I/O only (read-only for safety)
- Node.js runtime required
- Sensitive data via env vars (no config files)

### Assumptions
- Jira PAT token provided and valid
- Project files accessible locally
- Framework marker files present (for auto-detection)
- Team context file optional (fallback to defaults)

## Risk Assessment

### Technical Risks
1. **Jira API Rate Limiting**
   - Impact: Tools slow down / timeout
   - Mitigation: Implement retry with exponential backoff, cache results

2. **Large Codebase Scanning**
   - Impact: Slow detection, memory usage
   - Mitigation: Respect maxFileSizeKb, limit window to recent files

3. **Framework Detection Fails**
   - Impact: Fallback to generic patterns, miss files
   - Mitigation: Add marker files to project, manual config override

### Business Risks
1. **Low Adoption**
   - Mitigation: Training, documentation, success stories

2. **AI Generates Incorrect Code**
   - Mitigation: Quality gates, security checks, user review required

3. **Data Leakage (API tokens, secrets)**
   - Mitigation: Never log tokens, validate inputs, audit error messages

## Open Questions & TODOs

### Documentation
- [ ] Deployment guide for enterprise Jira
- [ ] Team context template per framework
- [ ] Security patterns checklist (expand 7 domains)

### Features
- [ ] Pagination for large result sets
- [ ] Codebase indexing on startup (vs scan-on-demand)
- [ ] Multi-Jira-instance support
- [ ] Dashboard UI (web interface)

### Testing
- [ ] Unit test suite (Jest/Vitest)
- [ ] Integration tests with mock Jira API
- [ ] E2E test for full workflow

### Performance
- [ ] Benchmark scoring algorithm at 1000 files
- [ ] Profile memory usage under load
- [ ] Optimize file scanning (parallel reads?)

## References

- **MCP Protocol:** https://modelcontextprotocol.io/
- **Jira REST API v3:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- **TypeScript:** https://www.typescriptlang.org/
- **Zod:** https://zod.dev/

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-26 | Initial release with 28 modules, 60+ tools |
| TBD | Future | Plugin system enhancements, dashboards |

---

**Last Updated:** 2026-03-26
**Owner:** VNPT Dev Team
**Status:** Active Development
