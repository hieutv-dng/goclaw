import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { resolveStackProfile } from "../stack-profiles/index.js";
import { withErrorHandler, getChainHint } from "../shared/index.js";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// Code Quality Gate
//
// Kiểm tra lint/build/test trước khi cho phép
// close task hoặc submit logwork.
// ─────────────────────────────────────────────

export function registerQualityGateTools(server: McpServer) {

  server.tool(
    "check_quality_gate",
    "Kiểm tra code quality trước khi close task: lint, build, test. " +
    "Gọi TRƯỚC khi `update_issue_status` hoặc `generate_worklog`. " +
    "→ Tiếp: Nếu pass → `generate_worklog` → `close-task`.",
    {
      projectRoot: z.string().describe("Đường dẫn codebase"),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack. 'auto' = tự detect."),
      skipTests: z.boolean().default(false)
        .describe("Bỏ qua test suite. Dùng khi project chưa có test."),
      baseBranch: z.string().default("develop")
        .describe("Branch gốc để đếm file thay đổi"),
    },
    withErrorHandler("check_quality_gate", async ({ projectRoot, stack, skipTests, baseBranch }) => {

      const profile = await resolveStackProfile(stack, projectRoot);
      const checks: QualityCheck[] = [];

      // ── 1. Build / Type check ─────────────────
      const buildCmd = getBuildCommand(profile.name);
      if (buildCmd) {
        const buildResult = await runCheck(buildCmd, projectRoot);
        checks.push({
          name: "🔨 Build / Type Check",
          command: buildCmd,
          passed: buildResult.exitCode === 0,
          output: buildResult.output,
          errorCount: countErrors(buildResult.output),
        });
      }

      // ── 2. Lint ───────────────────────────────
      const lintCmd = getLintCommand(profile.name);
      if (lintCmd) {
        const lintResult = await runCheck(lintCmd, projectRoot);
        checks.push({
          name: "🧹 Lint",
          command: lintCmd,
          passed: lintResult.exitCode === 0,
          output: lintResult.output,
          errorCount: countErrors(lintResult.output),
        });
      }

      // ── 3. Tests ──────────────────────────────
      if (!skipTests) {
        const testCmd = getTestCommand(profile.name);
        if (testCmd) {
          const testResult = await runCheck(testCmd, projectRoot);
          checks.push({
            name: "🧪 Tests",
            command: testCmd,
            passed: testResult.exitCode === 0,
            output: testResult.output,
            errorCount: countTestFailures(testResult.output),
          });
        }
      }

      // ── 4. Git status ─────────────────────────
      let uncommittedCount = 0;
      let changedFileCount = 0;
      try {
        const { stdout: statusOut } = await execAsync(
          "git status --porcelain",
          { cwd: projectRoot }
        );
        uncommittedCount = statusOut.trim().split("\n").filter(Boolean).length;

        const { stdout: diffOut } = await execAsync(
          `git diff --name-only ${baseBranch}...HEAD`,
          { cwd: projectRoot }
        );
        changedFileCount = diffOut.trim().split("\n").filter(Boolean).length;
      } catch { /* not a git repo */ }

      // ── 5. Summary ────────────────────────────
      const allPassed = checks.every(c => c.passed);
      const totalErrors = checks.reduce((sum, c) => sum + c.errorCount, 0);

      const lines = [
        `# ${allPassed ? "✅" : "❌"} Quality Gate — ${profile.displayName}`,
        "",
        `| Check | Status | Errors |`,
        `|---|---|---|`,
        ...checks.map(c =>
          `| ${c.name} | ${c.passed ? "✅ Pass" : "❌ Fail"} | ${c.errorCount} |`
        ),
        uncommittedCount > 0
          ? `| 📦 Uncommitted files | ⚠️ | ${uncommittedCount} files |`
          : `| 📦 Git status | ✅ Clean | 0 |`,
        "",
        `**Files changed vs ${baseBranch}:** ${changedFileCount}`,
        "",
      ];

      if (!allPassed) {
        lines.push(
          "## ❌ Gate BLOCKED",
          `**${totalErrors} errors** cần fix trước khi close task.`,
          "",
          "### Chi tiết lỗi",
          ...checks
            .filter(c => !c.passed)
            .map(c => [
              `#### ${c.name} (${c.command})`,
              "```",
              c.output.slice(0, 500),
              c.output.length > 500 ? "... (truncated)" : "",
              "```",
            ].join("\n")),
        );
      } else {
        lines.push(
          "## ✅ Gate PASSED",
          "Code sẵn sàng để close task!",
          "",
          "📌 **Next step:** `generate_worklog` → `log_work` → `update_issue_status`",
        );
      }

      if (uncommittedCount > 0) {
        lines.push(
          "",
          `⚠️ **Có ${uncommittedCount} file chưa commit.** Hãy commit trước khi tạo PR.`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("check_quality_gate") }],
      };
    })
  );
}

// ── Helpers ──────────────────────────────────

interface QualityCheck {
  name: string;
  command: string;
  passed: boolean;
  output: string;
  errorCount: number;
}

async function runCheck(
  command: string,
  cwd: string
): Promise<{ exitCode: number; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 60000,
    });
    return { exitCode: 0, output: stdout + stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.code ?? 1,
      output: (e.stdout ?? "") + (e.stderr ?? ""),
    };
  }
}

function getBuildCommand(stack: string): string | null {
  const map: Record<string, string> = {
    angular: "npx ng build --configuration production 2>&1 || npx tsc --noEmit 2>&1",
    react: "npx tsc --noEmit 2>&1",
    nestjs: "npx tsc --noEmit 2>&1",
    spring: "mvn compile -q 2>&1",
    flutter: "flutter analyze 2>&1",
    generic: "npx tsc --noEmit 2>&1",
  };
  return map[stack] ?? "npx tsc --noEmit 2>&1";
}

function getLintCommand(stack: string): string | null {
  const map: Record<string, string> = {
    angular: "npx ng lint 2>&1",
    react: "npx eslint . --max-warnings=0 2>&1",
    nestjs: "npx eslint . --max-warnings=0 2>&1",
    spring: "mvn checkstyle:check -q 2>&1",
    flutter: "dart analyze 2>&1",
    generic: "npx eslint . 2>&1",
  };
  return map[stack] ?? null;
}

function getTestCommand(stack: string): string | null {
  const map: Record<string, string> = {
    angular: "npx ng test --watch=false --browsers=ChromeHeadless 2>&1",
    react: "npx vitest run --reporter=verbose 2>&1",
    nestjs: "npx jest --passWithNoTests 2>&1",
    spring: "mvn test -q 2>&1",
    flutter: "flutter test 2>&1",
    generic: "npm test 2>&1",
  };
  return map[stack] ?? null;
}

function countErrors(output: string): number {
  const errorMatches = output.match(/error/gi) ?? [];
  return Math.min(errorMatches.length, 99);
}

function countTestFailures(output: string): number {
  const failMatch = output.match(/(\d+) failed/i);
  return failMatch ? parseInt(failMatch[1]) : 0;
}
