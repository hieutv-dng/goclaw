# vnpt-dev-agent MCP Server

**AI Dev Agent for VNPT — Tích hợp Jira MCP**

A TypeScript-based Model Context Protocol (MCP) server that automates software development workflows for Vietnamese teams. It provides **60+ MCP tools** to manage tasks from Jira, analyze code, enforce quality standards, and generate reports.

## What It Does

### Core Features
- **Jira Integration** (7 tools) — List/read/update issues, log work, create tasks
- **Code Discovery** (5 tools) — Find relevant files per framework (Angular, React, NestJS, Spring, Flutter, Generic)
- **Task Analysis** — Evaluate complexity, clarity, and risks
- **Quality Gates** — Security checks (7 domains), GWT validation, drift detection
- **Learning Loop** — Feedback submission, metrics tracking, insights
- **Session Memory** — Save/load context across chat sessions

### Key Workflows
```
task_kickoff → get_team_context → check_security_flag
→ detect_files_from_task → evaluate_task_complexity
→ [Claude codes] → check_quality_gate → generate_pr_description
→ generate_worklog → submit_feedback → save_session
```

## 28 Modules, 60+ Tools

Organized into groups:
- **Core (3):** Jira, Codebase, Evaluator
- **Context (2):** Team Context, Git Standard
- **Quality (5):** GWT, Security, Drift, Feedback, Metrics
- **Parsing (4):** Parser, Logwork, Kickoff, Quality Gate
- **Code Gen (4):** Template, PR Generator, Impact Analysis, Estimation
- **Session (4):** Session, Docs Discovery, Knowledge, Plugins
- **Infrastructure (2):** Stack Profiles, Shared Utilities

For details, see [Codebase Summary](docs/codebase-summary.md).

## Getting Started

### Prerequisites
- Node.js v18+
- Jira Cloud instance + Personal Access Token
- Claude Desktop or IDE with MCP support

### Lấy Jira Personal Access Token

1. Đăng nhập vào `https://one-ai.vnpt.vn`
2. Click vào **avatar** góc trên phải → **Profile**
3. Vào tab **Personal Access Tokens**
4. Click **Create Token** → đặt tên → **Create**
5. Copy token và dán vào `.env`

> ⚠️ Token chỉ hiển thị 1 lần, hãy copy ngay!

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vnpt-dev/vnpt-dev-agent.git
cd vnpt-dev-agent
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
JIRA_BASE_URL=https://your-jira-instance.atlassian.net
JIRA_PAT=your-personal-access-token
JIRA_DEFAULT_PROJECT=PROJ
```

4. Build the server:
```bash
npm run build
```

### Using with Claude Desktop

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vnpt-dev-agent": {
      "command": "node",
      "args": ["/ĐƯỜNG_DẪN_TUYỆT_ĐỐI/vnpt-dev-agent/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://one-ai.vnpt.vn",
        "JIRA_PAT": "your_token_here"
      }
    }
  }
}
```

> 💡 Hoặc để trống `env` và dùng file `.env` — cả 2 cách đều hoạt động.

Sau khi lưu config, **restart Claude Desktop**. Agent sẽ xuất hiện trong Tools panel.

### Using Remote MCP Server (Team Trial)

For shared team access via remote tunnel:
- **Admin:** See [Remote MCP Guide — Admin Section](docs/REMOTE_MCP_GUIDE.md#admin-chạy-server)
- **Client:** See [Remote MCP Guide — Client Setup](docs/REMOTE_MCP_GUIDE.md)

Recommended for short-term trials only.

### Ví dụ câu lệnh trong Claude Desktop

Sau khi tích hợp xong, bạn chat với Claude:

```
"Cho tôi xem danh sách task OPEN của tôi trong project VNPTAI"

"Đọc chi tiết task VNPTAI-123 và phân tích tôi cần làm gì"

"Logwork 2h30m cho task VNPTAI-123, đã implement API endpoint login"

"Chuyển task VNPTAI-123 sang trạng thái In Review"
```

## Development

### Run in Dev Mode
```bash
npm run dev    # tsx watch src/index.ts
```

### Debug with MCP Inspector
```bash
npm run inspect
```

Opens browser with interactive tool testing.

### Build
```bash
npm run build  # tsc → dist/
```

### Start
```bash
npm start      # node dist/index.js
```

## Project Structure

```
src/
├── index.ts                    # MCP server entry point
├── jira/                       # Jira REST API integration (7 tools)
├── codebase/                   # Code discovery & ranking (5 tools)
├── evaluator/                  # Task complexity analysis
├── team-context/               # Tribal knowledge management
├── git-standard/               # Git workflow standards
├── gwt/                        # Given-When-Then validation
├── security/                   # Security checks (7 domains)
├── drift/                      # Requirement drift detection
├── feedback/                   # Learning feedback loop
├── metric-stores/              # Metrics tracking & insights
├── session/                    # Session persistence
├── plugins/                    # Plugin system
├── stack-profiles/             # Multi-framework support
├── shared/                     # Utilities & error handling
└── ...                         # 18 more modules
```

For complete structure, see [System Architecture](docs/system-architecture.md).

## Documentation

- **[Project Overview & PDR](docs/project-overview-pdr.md)** — Goals, requirements, design decisions
- **[Codebase Summary](docs/codebase-summary.md)** — Module breakdown, 28 modules + 60+ tools
- **[Code Standards](docs/code-standards.md)** — Conventions, patterns, best practices
- **[System Architecture](docs/system-architecture.md)** — Data flow, components, decision rationale
- **[Project Roadmap](docs/project-roadmap.md)** — Phases, milestones, future plans
- **[Project Setup](docs/PROJECT_SETUP.md)** — First-time setup for new projects
- **[Quickstart](docs/QUICKSTART.md)** — Workflow guide for developers
- **[Git Standard](docs/GIT_STANDARD.md)** — Git conventions & branch naming
- **[GWT Template](docs/GWT_TEMPLATE_GUIDE.md)** — Writing clear task descriptions
- **[Security Patterns](docs/SECURITY_PATTERNS.md)** — Security requirements checklist
- **[Team Context](docs/TEAM_CONTEXT.md)** — Tribal knowledge template

## Configuration

### mcp-config.json
Default settings for all projects:
```json
{
  "defaults": {
    "stack": "auto",           // Auto-detect framework
    "topK": 5,                 // Top 5 relevant files
    "recentFileWindowMinutes": 480,  // 8-hour window
    "maxFileSizeKb": 50        // Skip large files
  }
}
```

### Environment Variables
```
JIRA_BASE_URL            # Jira instance URL
JIRA_PAT                 # Personal Access Token (never commit!)
JIRA_DEFAULT_PROJECT     # Default project key
```

## Phase 1 Tools

| Tool | Mô tả |
|------|-------|
| `list_my_open_issues` | Lấy danh sách task OPEN của bạn |
| `get_issue_detail` | Đọc chi tiết 1 issue |
| `log_work` | Logwork thời gian lên issue |
| `update_issue_status` | Chuyển trạng thái issue |
| `get_available_transitions` | Xem các transition có thể làm |
| `create_issue` | Tạo issue mới (Task/Sub-task/Bug) |

## Key Features

### Multi-Framework Code Discovery
Automatically detects and supports:
- **Angular** — src/app/*.ts, angular.json
- **React** — src/components/*.tsx, package.json
- **NestJS** — src/*.controller.ts, src/*.service.ts
- **Spring** — src/main/java/*Controller.java, pom.xml
- **Flutter** — lib/*.dart, pubspec.yaml
- **Generic** — Fallback for other frameworks

### Intelligent File Ranking (SmartScorer)
Files ranked by 4 signals:
1. **TF-IDF** from task description
2. **File name** relevance
3. **Recency** (recently modified)
4. **Framework affinity** (matches detected stack)

### Security-First Approach
7 security domains checked:
- Authentication & Authorization
- Data Protection & Privacy
- Cryptography
- API Security
- Input Validation
- Error Handling
- Logging & Monitoring

### Learning Loop
- Submit feedback on task accuracy
- Track estimation accuracy, complexity assessment
- Generate insights and trends
- Improve predictions over time

## Status

**Current Version:** v1.0.0
**Status:** Stable Release
**Last Updated:** 2026-03-26

Completed:
- ✅ Core Jira integration (7 tools)
- ✅ Code discovery (5 tools)
- ✅ Quality gates & security
- ✅ Learning loop & metrics
- ✅ Session management
- ✅ Plugin system

Planned:
- ⏳ Web dashboard (v1.2.0)
- ⏳ Multi-Jira support (v2.0.0)
- 🔮 ML-based predictions (v3.0.0)

## Contributing

1. Follow [Code Standards](docs/code-standards.md)
2. Test locally with MCP Inspector
3. Update docs if API changes
4. Commit with conventional messages: `feat(jira): ...`, `fix(codebase): ...`
5. Submit PR with feedback on improvements

## Support

- **Issues:** GitHub Issues
- **Questions:** Internal Wiki / Team Slack
- **Feedback:** Submit via `submit_task_feedback` tool

## License

TBD (Internal VNPT project)

---

**Quick Links:**
- [📋 Full Documentation](docs/)
- [🏗️ System Architecture](docs/system-architecture.md)
- [🚀 Project Roadmap](docs/project-roadmap.md)
- [💻 Code Standards](docs/code-standards.md)
