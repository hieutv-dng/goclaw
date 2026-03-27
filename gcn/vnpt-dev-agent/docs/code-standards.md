# Code Standards — vnpt-dev-agent

Tài liệu này định rõ các chuẩn mã hóa, quy ước đặt tên, và best practices cho dự án.

## Language & TypeScript Configuration

**Version:** TypeScript 5.6, strict mode
**Target:** ES2022
**Module:** ESM (type: "module" trong package.json)

### tsconfig.json Highlights
- `strict: true`
- `esModuleInterop: true`
- `resolveJsonModule: true`
- `skipLibCheck: true` (tăng tốc build)

## File Naming Conventions

### Source Files (src/)
- **Pattern:** kebab-case với mô tả rõ ràng
- **Examples:**
  - ✅ `codebase/reader.ts` (CodebaseReader class)
  - ✅ `jira/client.ts` (Jira REST client)
  - ✅ `stack-profiles/profiles.ts` (Stack profile definitions)
  - ✅ `metric-stores/tools.ts` (Metrics tools)

### Directories
- **Pattern:** kebab-case, ngữ nghĩa liên quan tới nhóm tools
- **Examples:**
  - `jira/` — Jira integration tools
  - `codebase/` — Code discovery tools
  - `stack-profiles/` — Framework detection
  - `metric-stores/` — Metrics tracking

### Special Files
- `index.ts` — Barrel exports, server registration
- `tools.ts` — MCP tool definitions
- `client.ts` — API client wrappers
- `formatter.ts` — Response formatting
- `resolver.ts` — Auto-detection logic
- `profiles.ts` — Configuration presets
- `loader.ts` — Dynamic loading logic
- `sharing.ts` — Cross-module features
- `estimation.ts` — Calculation/prediction
- `utils.ts` — Utility functions

## Code Style & Patterns

### Imports
```typescript
// ✅ Preferred: ESM imports
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJiraTools } from "./jira/tools.js";

// ❌ Avoid: CJS require in ESM modules
// const { McpServer } = require("...");
```

### Error Handling
All async tools must use `withErrorHandler()` wrapper:

```typescript
export const tool = (server: McpServer) =>
  server.tool("tool_name", schema, withErrorHandler(async (input) => {
    // implementation
    return { status: "success", data: result };
  }));
```

### Tool Registration Pattern
```typescript
export async function registerMyTools(server: McpServer) {
  server.tool("tool_name", inputSchema, withErrorHandler(async (input) => {
    // validate input (zod already validates)
    // execute
    // return { content: [{ type: "text", text: result }] }
  }));
}
```

### MCP Server Tool Schema (Zod)
```typescript
import { z } from "zod";

const inputSchema = z.object({
  issueKey: z.string().describe("Jira issue key (e.g., PROJ-123)"),
  timeSpent: z.string().describe("Time in format: 1h 30m"),
});

server.tool("log_work", inputSchema, withErrorHandler(async (input) => {
  // ...
}));
```

### Response Format
All tools must return MCP-compliant response:

```typescript
return {
  content: [
    {
      type: "text",
      text: JSON.stringify({ status: "ok", data: result }, null, 2),
    },
  ],
};

// Error handling (withErrorHandler catches and formats)
throw new Error("Descriptive error message");
```

## Naming Conventions

### Variables & Functions
- **Pattern:** camelCase
- **Examples:**
  - `issueKey`, `timeSpent`, `recentFileWindowMinutes`
  - `getTeamContext()`, `detectFilesFromTask()`, `withErrorHandler()`

### Classes & Types
- **Pattern:** PascalCase
- **Examples:**
  - `CodebaseReader`, `SmartScorer`, `JiraClient`
  - `StackProfile`, `McpServer`

### Constants
- **Pattern:** UPPER_SNAKE_CASE
- **Examples:**
  - `STACK_PROFILES`, `DEFAULT_TOP_K`, `RECENT_FILE_WINDOW_MINUTES`

### Environment Variables
- **Pattern:** UPPER_SNAKE_CASE
- **Examples:**
  - `JIRA_BASE_URL`, `JIRA_PAT`, `JIRA_DEFAULT_PROJECT`
  - Loaded via `dotenv` in index.ts before all imports

### MCP Tool Names
- **Pattern:** snake_case (MCP convention)
- **Examples:**
  - `list_my_open_issues`, `get_issue_detail`, `log_work`
  - `detect_files_from_task`, `rank_context_files`
  - `submit_task_feedback`, `track_metric`

## Module Structure

Each tool module should follow this structure:

```typescript
// 1. Imports (ESM)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withErrorHandler } from "../shared/index.js";

// 2. Constants (if any)
const DEFAULT_LIMIT = 10;

// 3. Helper functions (if any)
async function fetchData() {
  // ...
}

// 4. Main export: register function
export async function registerMyTools(server: McpServer) {
  // Tool 1
  server.tool("tool_1_name", schema1, withErrorHandler(async (input) => {
    // implementation
  }));

  // Tool 2
  server.tool("tool_2_name", schema2, withErrorHandler(async (input) => {
    // implementation
  }));
}
```

## Configuration & Defaults

### mcp-config.json Structure
```json
{
  "server": {
    "name": "vnpt-dev-agent",
    "version": "1.0.0"
  },
  "defaults": {
    "stack": "auto",
    "topK": 5,
    "recentFileWindowMinutes": 480,
    "maxFileSizeKb": 50
  },
  "paths": {
    "teamContext": "TEAM_CONTEXT.md",
    "gitStandard": ["GIT_STANDARD.md", "docs/GIT_STANDARD.md"],
    "securityPatterns": "SECURITY_PATTERNS.md",
    "feedbackStore": ".vnpt-dev-agent/feedback-store.json",
    "metricsStore": ".vnpt-dev-agent/metrics-store.json"
  }
}
```

### Environment Variables
Must define in `.env`:
- `JIRA_BASE_URL` — Jira instance URL
- `JIRA_PAT` — Personal Access Token (không commit!)
- `JIRA_DEFAULT_PROJECT` — Default project key

## Type Safety

### Zod Schemas (Input Validation)
```typescript
const createIssueSchema = z.object({
  projectKey: z.string().describe("Jira project key"),
  issueType: z.enum(["Bug", "Task", "Story"]).describe("Issue type"),
  summary: z.string().describe("Issue summary"),
  description: z.string().optional().describe("Optional description"),
});
```

### Response Types (Informal)
```typescript
// Good: Clear return shape
async function getIssueDetail(key: string): Promise<{
  status: "success" | "error";
  data?: Record<string, any>;
  error?: string;
}> {
  // ...
}
```

## Comments & Documentation

### Module-level Comments
```typescript
/**
 * Jira integration module.
 *
 * Provides tools to:
 * - List open issues
 * - Get issue details
 * - Log work (requires confirmation)
 * - Update status
 */
```

### Complex Logic Comments
```typescript
// SmartScorer ranks files by 4 signals:
// 1. TF-IDF match with description
// 2. File name relevance
// 3. Recency (modified time)
// 4. Framework affinity
```

### TODO & FIXME
```typescript
// TODO: Implement pagination for large result sets
// FIXME: Handle timezone in logwork calculation
```

## Build & Runtime

### Build Command
```bash
npm run build          # tsc → dist/
```

### Dev Mode
```bash
npm run dev            # tsx watch src/index.ts
```

### Start Command
```bash
npm start              # node dist/index.js
```

### Inspect Mode (Debug)
```bash
npm run inspect        # MCP Inspector for debugging
```

## Testing Strategy

- Unit tests: Test helper functions, scoring logic
- Integration tests: Test tools with real Jira API (mocked responses)
- Manual: Test via MCP Inspector before commit

**Note:** No test framework configured yet (Jest/Vitest can be added)

## Performance Guidelines

### Codebase Search
- Respect `maxFileSizeKb` config (default: 50 KB)
- Limit results to `topK` (default: 5)
- Use recent file window (default: 480 minutes / 8 hours)

### Jira API Calls
- Cache results when possible (session storage)
- Batch operations (e.g., get multiple issues in one call)
- Implement retry logic for rate limiting

### File I/O
- Use async/await consistently
- Handle large JSON files with streaming if needed
- Cache parsed configs

## Security Guidelines

### API Keys & Tokens
- ❌ Never commit `.env` or `.env.local`
- ✅ Use environment variables for sensitive data
- ✅ Validate Jira PAT before use

### SQL Injection (N/A)
- No SQL in this project (pure Node.js + HTTP APIs)

### Input Validation
- ✅ Always validate via Zod schemas
- ✅ Sanitize user inputs before using in URLs or commands
- ❌ Don't pass unsanitized strings to shell commands

### Error Messages
- ✅ Log full errors in development/debug modes
- ✅ Return user-friendly messages in production
- ❌ Don't expose sensitive paths or API details

## Common Patterns

### Conditional Exports
```typescript
export async function registerMyTools(server: McpServer) {
  if (process.env.ENABLE_EXPERIMENTAL_TOOLS === "true") {
    // register experimental tool
  }
}
```

### Resource Registration
```typescript
// In resources/index.ts
server.resource("uri://team-context", {
  uri: "memory://team-context",
  name: "Team Context",
  mimeType: "text/markdown",
});
```

### Prompt Registration
```typescript
// In prompts/index.ts
server.prompt("start", {
  description: "Start task kickoff workflow",
  arguments: [],
});
```

## File Size Targets

Giữ files dưới 200 LOC nếu có thể:
- **codebase/reader.ts** — File reader logic
- **codebase/scorer.ts** — Scoring algorithm
- **codebase/tools.ts** — Tool definitions (có thể > 200 LOC)

Hiện tại, một số files vượt 200 LOC (tools files), nhưng việc tách nhỏ không cần thiết vì chúng là definitions.

## Git & Commit Conventions

### Branch Naming
```
feature/PROJ-123-feature-description
fix/PROJ-456-bug-description
docs/update-readme
refactor/improve-scoring-logic
```

### Commit Messages
```
feat(jira): add log_work tool
fix(codebase): improve file ranking logic
docs(readme): update installation steps
refactor(scorer): simplify multi-signal calculation
test(feedback): add feedback storage tests
chore: update dependencies
```

Follow **Conventional Commits** format: `type(scope): description`

## Dependencies & Updates

### Current Stack
- `@modelcontextprotocol/sdk` ^1.0.0
- `axios` ^1.7.0
- `dotenv` ^16.4.0
- `zod` ^3.23.0

### Before Adding New Dependency
1. Check if existing deps cover the need
2. Verify ESM compatibility (no CJS-only packages)
3. Update package-lock.json
4. Document why it's needed

## Changelog

When modifying existing code or adding features, update:
- **Related comments** in source files
- **This document** if conventions change
- **docs/project-changelog.md** if impact is significant
