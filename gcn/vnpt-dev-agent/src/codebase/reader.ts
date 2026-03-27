import fs from "fs/promises";
import path from "path";
import { StackProfile, ANGULAR_PROFILE } from "../stack-profiles/index.js";

// ─────────────────────────────────────────────
// CodebaseReader
//
// Class xử lý toàn bộ việc đọc file từ filesystem.
// Tách riêng khỏi tools.ts để dễ test và maintain.
//
// Multi-framework: Dùng StackProfile để cấu hình
// extensions, ignore patterns, language mapping
// thay vì hardcode Angular.
// ─────────────────────────────────────────────

interface FileResult {
  relativePath: string;
  absolutePath: string;
  content: string;
  language: string;
  sizeKb: number;
}

interface SearchMatch {
  lineNumber: number;
  line: string;
  context: string; // 3 dòng xung quanh
}

interface SearchResult {
  relativePath: string;
  absolutePath: string;
  matches: SearchMatch[];
}

interface ModuleReadResult {
  files: (FileResult & { relativePath: string })[];
  totalSizeKb: number;
}

// ── Ignore patterns chung (framework-agnostic) ──
// Luôn ignore những thứ này BẤT KỂ framework nào
const BASE_IGNORE = [
  "node_modules", ".git", "coverage", ".nyc_output",
  "__pycache__", ".cache", "tmp", "temp",
];

export class CodebaseReader {
  private profile: StackProfile;

  constructor(profile?: StackProfile) {
    this.profile = profile ?? ANGULAR_PROFILE;
  }

  /** Thay đổi profile runtime (VD: sau auto-detect) */
  setProfile(profile: StackProfile): void {
    this.profile = profile;
  }

  /** Lấy profile hiện tại */
  getProfile(): StackProfile {
    return this.profile;
  }

  // ── Tìm file theo tên class/component ─────────────────
  async findByName(
    name: string,
    projectRoot: string,
    includeContent: boolean
  ): Promise<(FileResult & { relativePath: string })[]> {
    // Dùng extensions từ profile thay vì hardcode [".ts", ".html"]
    const searchExtensions = this.profile.extensions;
    const allFiles = await this.walkDirectory(projectRoot, searchExtensions);
    const results: (FileResult & { relativePath: string })[] = [];

    for (const filePath of allFiles) {
      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      // Match theo 3 tiêu chí:
      // 1. Tên file chứa keyword (kebab-case hoặc original)
      const fileName = path.basename(filePath, path.extname(filePath));
      const nameToKebab = toKebabCase(name);
      const fileNameMatch = fileName.toLowerCase().includes(nameToKebab.toLowerCase()) ||
                            fileName.toLowerCase().includes(name.toLowerCase());

      // 2. Nội dung file chứa tên class/function chính xác
      const contentMatch = content.includes(name);

      // 3. Class/function/export declaration match
      const declarationMatch = content.includes(`class ${name}`) ||
                               content.includes(`export function ${name}`) ||
                               content.includes(`export const ${name}`);

      if (fileNameMatch || contentMatch || declarationMatch) {
        const stat = await fs.stat(filePath);
        results.push({
          relativePath: path.relative(projectRoot, filePath),
          absolutePath: filePath,
          content: includeContent ? content : "",
          language: this.getLang(filePath),
          sizeKb: Math.round(stat.size / 1024),
        });
      }
    }

    return results;
  }

  // ── Tìm keyword trong nội dung file ───────────────────
  async searchKeyword(
    keyword: string,
    projectRoot: string,
    extensions: string[],
    maxResults: number,
    showContext: boolean
  ): Promise<SearchResult[]> {
    const allFiles = await this.walkDirectory(projectRoot, extensions);
    const results: SearchResult[] = [];

    for (const filePath of allFiles) {
      if (results.length >= maxResults) break;

      const content = await this.readFileSafe(filePath);
      if (!content || !content.includes(keyword)) continue;

      const lines = content.split("\n");
      const matches: SearchMatch[] = [];

      lines.forEach((line, idx) => {
        if (!line.includes(keyword)) return;

        // Lấy 2 dòng trước và sau để hiểu ngữ cảnh
        const contextLines = lines.slice(
          Math.max(0, idx - 2),
          Math.min(lines.length, idx + 3)
        );

        matches.push({
          lineNumber: idx + 1,
          line: line.trim(),
          context: contextLines
            .map((l, i) => {
              const lineNum = Math.max(0, idx - 2) + i + 1;
              const marker = lineNum === idx + 1 ? "→" : " ";
              return `  ${marker} ${lineNum}: ${l}`;
            })
            .join("\n"),
        });
      });

      if (matches.length > 0) {
        results.push({
          relativePath: path.relative(projectRoot, filePath),
          absolutePath: filePath,
          matches: matches.slice(0, 5), // Tối đa 5 match mỗi file
        });
      }
    }

    return results;
  }

  // ── Đọc toàn bộ module/folder ──────────────────────────
  async readModule(
    modulePath: string,
    options: { includeHtml: boolean; includeScss: boolean; maxFileSizeKb: number }
  ): Promise<ModuleReadResult> {
    // Dùng extensions từ profile, filter theo options
    const extensions = this.profile.extensions.filter((ext) => {
      // Luôn include code files (non-template, non-style)
      const isTemplate = [".html", ".xml"].includes(ext);
      const isStyle = [".scss", ".css"].includes(ext);
      if (isTemplate && !options.includeHtml) return false;
      if (isStyle && !options.includeScss) return false;
      return true;
    });

    const allFiles = await this.walkDirectory(modulePath, extensions);
    const files: (FileResult & { relativePath: string })[] = [];
    let totalSize = 0;

    for (const filePath of allFiles) {
      const stat = await fs.stat(filePath);
      const sizeKb = Math.round(stat.size / 1024);

      // Bỏ qua file quá lớn (thường là generated file)
      if (sizeKb > options.maxFileSizeKb) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      files.push({
        relativePath: path.relative(modulePath, filePath),
        absolutePath: filePath,
        content,
        language: this.getLang(filePath),
        sizeKb,
      });

      totalSize += sizeKb;
    }

    // Sort theo thứ tự ưu tiên từ profile extensions
    const extOrder = this.profile.extensions;
    files.sort((a, b) => {
      const extA = path.extname(a.absolutePath);
      const extB = path.extname(b.absolutePath);
      return extOrder.indexOf(extA) - extOrder.indexOf(extB);
    });

    return { files, totalSizeKb: totalSize };
  }

  // ── Lấy cấu trúc monorepo (2 levels deep) ─────────────
  async getMonorepoStructure(
    projectRoot: string,
    appsFolder: string,
    libsFolder: string
  ): Promise<string> {
    const lines: string[] = [path.basename(projectRoot) + "/"];

    for (const folder of [appsFolder, libsFolder]) {
      const folderPath = path.join(projectRoot, folder);
      try {
        const apps = await fs.readdir(folderPath);
        lines.push(`  ${folder}/`);

        for (const app of apps.slice(0, 20)) { // Tối đa 20 apps
          const appPath = path.join(folderPath, app);
          const stat = await fs.stat(appPath);
          if (!stat.isDirectory()) continue;

          lines.push(`    ${app}/`);

          // Hiển thị src structure dựa trên profile
          const srcPath = path.join(appPath, this.profile.projectStructure.srcPattern);
          try {
            const srcContents = await fs.readdir(srcPath);
            for (const item of srcContents.slice(0, 10)) {
              lines.push(`      ${item}/`);
            }
          } catch {
            // src path không tồn tại → bỏ qua
          }
        }
      } catch {
        // Folder không tồn tại → bỏ qua
      }
    }

    return lines.join("\n");
  }

  // ── Private helpers ────────────────────────────────────

  /**
   * Lấy language name từ file extension, dùng profile langMap
   */
  private getLang(filePath: string): string {
    return this.profile.langMap[path.extname(filePath)] ?? "text";
  }

  /**
   * Merge ignore patterns: base (luôn ignore) + profile-specific
   */
  private getIgnorePatterns(): string[] {
    const profileIgnore = this.profile.ignorePatterns;
    const merged = new Set([...BASE_IGNORE, ...profileIgnore]);
    return Array.from(merged);
  }

  /**
   * Walk directory đệ quy, bỏ qua các folder không cần thiết
   */
  private async walkDirectory(dir: string, extensions: string[]): Promise<string[]> {
    const results: string[] = [];
    const ignorePatterns = this.getIgnorePatterns();

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return []; // Folder không tồn tại hoặc không có quyền đọc
    }

    for (const entry of entries) {
      // Bỏ qua các pattern không cần thiết
      if (ignorePatterns.some((p) => entry === p || entry.startsWith("."))) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const subResults = await this.walkDirectory(fullPath, extensions);
        results.push(...subResults);
      } else if (extensions.includes(path.extname(entry))) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * Đọc file an toàn — trả về null nếu có lỗi
   * (không throw để không crash cả tool)
   */
  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Bỏ qua file quá lớn (> 200KB) để tránh token limit
      if (content.length > 200_000) return null;
      return content;
    } catch {
      return null;
    }
  }
}

// ─── Utility ──────────────────────────────────
/**
 * Chuyển PascalCase/camelCase → kebab-case
 * VD: UserProfileComponent → user-profile-component
 * Dùng cho nhiều framework: Angular, React, NestJS...
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
}