import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { resolveStackProfile } from "../stack-profiles/index.js";
import fs from "fs/promises";
import path from "path";
import { withErrorHandler, getChainHint } from "../shared/index.js";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// Dependency Impact Analysis
//
// Phân tích khi sửa 1 file → ảnh hưởng tới đâu?
// Dựa trên import/require graph.
// ─────────────────────────────────────────────

export function registerImpactTools(server: McpServer) {

  server.tool(
    "analyze_impact",
    "Phân tích impact khi sửa file: ai import file này? Module nào bị ảnh hưởng? " +
    "Dùng TRƯỚC khi implement để hiểu phạm vi thay đổi. " +
    "→ Tiếp: `detect_files_from_task` để bổ sung file thiếu.",
    {
      filePaths: z.array(z.string())
        .describe("Danh sách file sẽ sửa. VD: ['src/app/auth/auth.service.ts']"),
      projectRoot: z.string()
        .describe("Đường dẫn project root"),
      stack: z.enum(["auto", "angular", "spring", "nestjs", "flutter", "react", "generic"])
        .default("auto")
        .describe("Tech stack"),
      depth: z.number().default(2)
        .describe("Số tầng dependency cần quét. Default: 2"),
    },
    withErrorHandler("analyze_impact", async ({ filePaths, projectRoot, stack, depth }) => {

      const profile = await resolveStackProfile(stack, projectRoot);
      const importPattern = getImportPattern(profile.name);

      const allImpacts: FileImpact[] = [];

      for (const filePath of filePaths) {
        const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
        const impacts = await findReverseImports(
          relativePath,
          projectRoot,
          importPattern,
          depth,
          profile.extensions
        );
        allImpacts.push({
          sourceFile: relativePath,
          importedBy: impacts,
        });
      }

      // Categorize
      const allAffected = new Set<string>();
      const moduleMap = new Map<string, string[]>();

      for (const impact of allImpacts) {
        for (const dep of impact.importedBy) {
          allAffected.add(dep.file);
          const module = extractModule(dep.file, profile.name);
          if (!moduleMap.has(module)) moduleMap.set(module, []);
          moduleMap.get(module)!.push(dep.file);
        }
      }

      // Build output
      const lines = [
        `# 🔍 Impact Analysis`,
        "",
        `**Files analyzed:** ${filePaths.length}`,
        `**Total affected:** ${allAffected.size} files`,
        `**Modules affected:** ${moduleMap.size}`,
        `**Depth:** ${depth} levels`,
        "",
      ];

      // Per-file impact
      for (const impact of allImpacts) {
        lines.push(
          `## 📄 \`${impact.sourceFile}\``,
          "",
        );

        if (impact.importedBy.length === 0) {
          lines.push("_Không có file nào import file này_ (leaf node)", "");
          continue;
        }

        lines.push(
          `| File | Depth | Type |`,
          `|---|---|---|`,
          ...impact.importedBy.map(d =>
            `| \`${d.file}\` | ${d.depth} | ${categorizeFile(d.file, profile.name)} |`
          ),
          "",
        );
      }

      // Module summary
      if (moduleMap.size > 0) {
        lines.push(
          "## 📦 Modules ảnh hưởng",
          "",
          ...Array.from(moduleMap.entries()).map(([mod, files]) =>
            `- **${mod}** (${files.length} files)`
          ),
          "",
        );
      }

      // Recommendations
      lines.push(
        "---",
        "## 💡 Khuyến nghị",
      );

      if (allAffected.size > 10) {
        lines.push("⚠️ **High impact** — thay đổi ảnh hưởng >10 files. Xem xét tạo PR nhỏ hơn.");
      }
      if (moduleMap.size > 3) {
        lines.push("⚠️ **Cross-module** — thay đổi ảnh hưởng >3 modules. Cần review kỹ.");
      }

      const testFiles = [...allAffected].filter(f =>
        f.includes(".spec.") || f.includes(".test.") || f.includes("_test.")
      );
      if (testFiles.length > 0) {
        lines.push(
          "",
          `### 🧪 Test files cần chạy lại`,
          ...testFiles.map(f => `- \`${f}\``),
        );
      }

      lines.push(
        "",
        "📌 **Next step:** Thêm các file bị ảnh hưởng vào context bằng `detect_files_from_task`.",
      );

      return {
        content: [{ type: "text", text: lines.join("\n") + getChainHint("analyze_impact") }],
      };
    })
  );
}

// ── Helpers ──────────────────────────────────

interface FileImpact {
  sourceFile: string;
  importedBy: Array<{ file: string; depth: number }>;
}

function getImportPattern(stack: string): string {
  // grep pattern to find imports
  const patterns: Record<string, string> = {
    angular: "from ['\"]",
    react: "from ['\"]",
    nestjs: "from ['\"]",
    flutter: "import ['\"]",
    spring: "import ",
    generic: "from ['\"]|require\\(",
  };
  return patterns[stack] ?? patterns.generic;
}

async function findReverseImports(
  targetFile: string,
  projectRoot: string,
  _importPattern: string,
  maxDepth: number,
  extensions: string[]
): Promise<Array<{ file: string; depth: number }>> {
  const results: Array<{ file: string; depth: number }> = [];
  const visited = new Set<string>();

  // Extract the file stem for searching (remove extension and path)
  const stem = path.basename(targetFile).replace(/\.[^.]+$/, "");

  async function search(target: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    const extGlob = extensions.map(e => `--include=*${e}`).join(" ");
    try {
      const { stdout } = await execAsync(
        `grep -rl ${extGlob} "${target.replace(/\.[^.]+$/, "")}" . 2>/dev/null || true`,
        { cwd: projectRoot, timeout: 15000 }
      );

      const files = stdout.trim().split("\n")
        .filter(Boolean)
        .map(f => f.replace(/^\.\//, "").replace(/\\/g, "/"))
        .filter(f => f !== targetFile && !visited.has(f));

      for (const file of files) {
        visited.add(file);
        results.push({ file, depth: currentDepth });
        if (currentDepth < maxDepth) {
          await search(file, currentDepth + 1);
        }
      }
    } catch {
      // grep not available or timeout — try findstr on Windows
      try {
        const { stdout } = await execAsync(
          `findstr /S /M /C:"${target.replace(/\.[^.]+$/, "")}" ${extensions.map(e => `*${e}`).join(" ")}`,
          { cwd: projectRoot, timeout: 15000 }
        );

        const files = stdout.trim().split("\n")
          .filter(Boolean)
          .map(f => f.trim().replace(/\\/g, "/"))
          .filter(f => f !== targetFile && !visited.has(f));

        for (const file of files) {
          visited.add(file);
          results.push({ file, depth: currentDepth });
        }
      } catch { /* fallback also failed */ }
    }
  }

  await search(stem, 1);
  return results;
}

function extractModule(filePath: string, stack: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");

  if (stack === "angular" || stack === "react" || stack === "nestjs") {
    // Extract the feature/module folder
    const srcIdx = parts.indexOf("src");
    if (srcIdx >= 0 && parts.length > srcIdx + 2) {
      return parts[srcIdx + 1] + "/" + parts[srcIdx + 2];
    }
  }

  if (stack === "flutter") {
    const libIdx = parts.indexOf("lib");
    if (libIdx >= 0 && parts.length > libIdx + 2) {
      return parts[libIdx + 1] + "/" + parts[libIdx + 2];
    }
  }

  if (stack === "spring") {
    // Use package name
    return parts.slice(-3, -1).join("/");
  }

  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0] ?? "root";
}

function categorizeFile(filePath: string, _stack: string): string {
  if (filePath.includes(".spec.") || filePath.includes(".test.") || filePath.includes("_test.")) return "🧪 Test";
  if (filePath.includes(".component.")) return "🎨 Component";
  if (filePath.includes(".service.")) return "⚙️ Service";
  if (filePath.includes(".module.")) return "📦 Module";
  if (filePath.includes(".controller.")) return "🌐 Controller";
  if (filePath.includes(".pipe.") || filePath.includes(".directive.")) return "🔧 Utility";
  if (filePath.includes(".html") || filePath.includes(".scss")) return "🎨 Template";
  return "📄 Other";
}
