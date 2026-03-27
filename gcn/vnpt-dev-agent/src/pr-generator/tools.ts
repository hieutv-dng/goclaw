import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraClient } from "../jira/client.js";
import { resolveStackProfile } from "../stack-profiles/index.js";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { withErrorHandler, getChainHint } from "../shared/index.js";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// PR Description Generator
//
// Tự sinh nội dung PR từ:
//   1. Jira task (summary, description, type)
//   2. Git diff  (changed files)
//   3. Recent commits
//   4. DONE_WHEN checklist
// ─────────────────────────────────────────────

export function registerPRTools(server: McpServer) {

  server.tool(
    "generate_pr_description",
    "Tự động sinh PR description từ Jira task + git diff + commits. " +
    "Trả về nội dung sẵn sàng paste vào PR. " +
    "⚠️ PHẢI hiển thị cho user review trước khi tạo PR.",
    {
      issueKey: z.string().describe("Jira issue key. VD: 'VNPTAI-123'"),
      projectRoot: z.string().describe("Đường dẫn codebase để lấy git info"),
      baseBranch: z.string().default("develop")
        .describe("Branch gốc để so sánh diff. Mặc định: 'develop'"),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack. 'auto' = tự detect."),
    },
    withErrorHandler("generate_pr_description", async ({ issueKey, projectRoot, baseBranch, stack }) => {

      // 1. Đọc Jira task
      const issue = await jiraClient.getIssue(issueKey);
      const fields = issue.fields;
      const summary: string = fields.summary ?? "";
      const description: string = fields.description ?? "";
      const issueType: string = fields.issuetype?.name ?? "Task";
      const priority: string = fields.priority?.name ?? "Medium";

      // 2. Parse DONE_WHEN từ description
      const doneWhen = extractChecklist(description, "DONE_WHEN");
      const scenarios = extractScenarioNames(description);

      // 3. Git info
      let changedFiles: string[] = [];
      let recentCommits: string[] = [];
      let currentBranch = "";

      try {
        const { stdout: branchOut } = await execAsync(
          "git rev-parse --abbrev-ref HEAD",
          { cwd: projectRoot }
        );
        currentBranch = branchOut.trim();

        const { stdout: diffOut } = await execAsync(
          `git diff --name-status ${baseBranch}...HEAD`,
          { cwd: projectRoot }
        );
        changedFiles = diffOut.trim().split("\n").filter(Boolean);

        const { stdout: logOut } = await execAsync(
          `git log ${baseBranch}..HEAD --oneline --no-merges -20`,
          { cwd: projectRoot }
        );
        recentCommits = logOut.trim().split("\n").filter(Boolean);
      } catch {
        // Git commands may fail if not in git repo
      }

      // 4. Stack info
      const profile = await resolveStackProfile(stack, projectRoot);

      // 5. Categorize changed files
      const added = changedFiles.filter(f => f.startsWith("A\t")).map(f => f.slice(2));
      const modified = changedFiles.filter(f => f.startsWith("M\t")).map(f => f.slice(2));
      const deleted = changedFiles.filter(f => f.startsWith("D\t")).map(f => f.slice(2));

      // 6. Build PR description
      const prContent = [
        `## 📋 ${issueType}: ${summary}`,
        "",
        `**Jira:** ${issueKey}`,
        `**Branch:** \`${currentBranch}\` → \`${baseBranch}\``,
        `**Stack:** ${profile.displayName}`,
        `**Priority:** ${priority}`,
        "",

        // What & Why
        "### 🎯 What does this PR do?",
        description
          ? extractSection(description, "WHAT") || `Implements ${summary}`
          : `Implements ${summary}`,
        "",

        // Why
        "### 💡 Why?",
        extractSection(description, "WHY") || `Task requirement: ${issueKey}`,
        "",

        // Changes
        "### 📁 Changes",
        ...(added.length > 0 ? [
          "**Added:**",
          ...added.map(f => `- \`${f}\``),
        ] : []),
        ...(modified.length > 0 ? [
          "**Modified:**",
          ...modified.map(f => `- \`${f}\``),
        ] : []),
        ...(deleted.length > 0 ? [
          "**Deleted:**",
          ...deleted.map(f => `- ~~\`${f}\`~~`),
        ] : []),
        changedFiles.length === 0 ? "_Không có thay đổi git (chưa commit?)_" : "",
        "",

        // Commits
        ...(recentCommits.length > 0 ? [
          "### 📝 Commits",
          ...recentCommits.map(c => `- ${c}`),
          "",
        ] : []),

        // Checklist
        "### ✅ Checklist",
        ...(doneWhen.length > 0
          ? doneWhen.map(d => `- [ ] ${d}`)
          : ["- [ ] Feature hoạt động đúng", "- [ ] Không có lỗi console"]),
        "- [ ] Đã test thủ công",
        "- [ ] Code review passed",
        "",

        // Scenarios
        ...(scenarios.length > 0 ? [
          "### 🎬 Test Scenarios",
          ...scenarios.map((s, i) => `${i + 1}. ${s}`),
          "",
        ] : []),

        // Screenshot
        "### 📸 Screenshots",
        "_Thêm screenshots nếu có thay đổi UI_",
      ].filter(s => s !== undefined).join("\n");

      return {
        content: [{
          type: "text",
          text: [
            `# 🔀 PR Description — ${issueKey}`,
            "",
            "Nội dung bên dưới sẵn sàng paste vào PR:",
            "",
            "---",
            "",
            prContent,
            "",
            "---",
            "📌 **Next step:** Copy nội dung trên → Paste vào PR description.",
          ].join("\n") + getChainHint("generate_pr_description"),
        }],
      };
    })
  );
}

// ── Helpers ──────────────────────────────────

function extractChecklist(desc: string, section: string): string[] {
  const lines = desc.split("\n");
  const items: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.match(new RegExp(`^## \\[${section}\\]`, "i"))) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection) {
      const match = line.match(/^[-*]\s*\[.\]\s*(.+)/);
      if (match) items.push(match[1].trim());
      else if (line.trim().startsWith("- ")) items.push(line.trim().slice(2));
    }
  }
  return items;
}

function extractScenarioNames(desc: string): string[] {
  return (desc.match(/^### Scenario\s*\d*[:.]\s*(.+)/gm) ?? [])
    .map(m => m.replace(/^### Scenario\s*\d*[:.]\s*/, "").trim());
}

function extractSection(desc: string, section: string): string {
  const lines = desc.split("\n");
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.match(new RegExp(`^## \\[${section}\\]`, "i"))) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection && line.trim()) result.push(line.trim());
  }
  return result.join("\n");
}
