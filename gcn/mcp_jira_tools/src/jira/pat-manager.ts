import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────
// PAT Manager: Quản lý Jira Personal Access Token
//
// Đọc/ghi PAT trong file .env và cập nhật
// process.env + JiraClient tại runtime.
// ─────────────────────────────────────────────

/**
 * Tìm đường dẫn file .env
 * Ưu tiên: ENV_FILE_PATH → thư mục gốc project (cwd)
 */
function resolveEnvPath(): string {
  if (process.env.ENV_FILE_PATH) {
    return process.env.ENV_FILE_PATH;
  }

  // Tìm .env từ thư mục chứa src/ (project root)
  const projectRoot = path.resolve(__dirname, "../../");
  const envPath = path.join(projectRoot, ".env");

  if (fs.existsSync(envPath)) {
    return envPath;
  }

  // Fallback: current working directory
  const cwdEnv = path.join(process.cwd(), ".env");
  return cwdEnv;
}

/**
 * Đọc PAT hiện tại từ .env file
 * Trả về: { pat, envPath, exists }
 */
export function getCurrentPat(): {
  pat: string | null;
  envPath: string;
  exists: boolean;
  masked: string;
} {
  const envPath = resolveEnvPath();
  const exists = fs.existsSync(envPath);

  if (!exists) {
    return { pat: null, envPath, exists: false, masked: "(không có file .env)" };
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const match = content.match(/^JIRA_PAT=(.+)$/m);
  const pat = match ? match[1].trim() : null;

  return {
    pat,
    envPath,
    exists: true,
    masked: pat ? maskPat(pat) : "(chưa cấu hình)",
  };
}

/**
 * Cập nhật PAT trong .env file
 * - Nếu JIRA_PAT= đã tồn tại → replace giá trị
 * - Nếu chưa có → append vào cuối
 * - Cập nhật process.env để session hiện tại dùng ngay
 */
export function updatePat(newPat: string): {
  envPath: string;
  previousMasked: string;
  newMasked: string;
  action: "updated" | "added";
} {
  const envPath = resolveEnvPath();
  const previousInfo = getCurrentPat();
  let content = "";
  let action: "updated" | "added" = "added";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  // Kiểm tra xem JIRA_PAT đã tồn tại chưa
  const patRegex = /^JIRA_PAT=.*/m;

  if (patRegex.test(content)) {
    // Replace giá trị cũ
    content = content.replace(patRegex, `JIRA_PAT=${newPat}`);
    action = "updated";
  } else {
    // Append vào cuối file
    const separator = content.endsWith("\n") ? "" : "\n";
    content += `${separator}\n# Personal Access Token — lấy tại:\n# Jira → Profile → Personal Access Tokens → Create Token\nJIRA_PAT=${newPat}\n`;
    action = "added";
  }

  // Ghi file
  fs.writeFileSync(envPath, content, "utf-8");

  // Cập nhật process.env để session hiện tại dùng ngay
  process.env.JIRA_PAT = newPat;

  return {
    envPath,
    previousMasked: previousInfo.masked,
    newMasked: maskPat(newPat),
    action,
  };
}

/**
 * Validate PAT format cơ bản
 * PAT Jira Server thường là base64 string dài
 */
export function validatePat(pat: string): {
  valid: boolean;
  reason?: string;
} {
  const trimmed = pat.trim();

  if (!trimmed) {
    return { valid: false, reason: "PAT không được để trống" };
  }

  if (trimmed.length < 10) {
    return { valid: false, reason: "PAT quá ngắn (tối thiểu 10 ký tự)" };
  }

  if (/\s/.test(trimmed)) {
    return { valid: false, reason: "PAT không được chứa khoảng trắng" };
  }

  return { valid: true };
}

/**
 * Mask PAT để hiển thị an toàn
 * VD: "MzY1MzcwMDYw..." → "MzY1***...***zhSL"
 */
function maskPat(pat: string): string {
  if (pat.length <= 8) return "****";
  const prefix = pat.substring(0, 4);
  const suffix = pat.substring(pat.length - 4);
  return `${prefix}****${suffix}`;
}
