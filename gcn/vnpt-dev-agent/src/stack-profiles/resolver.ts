import fs from "fs/promises";
import path from "path";
import {
  StackProfile,
  StackName,
  ANGULAR_PROFILE,
  SPRING_PROFILE,
  NESTJS_PROFILE,
  FLUTTER_PROFILE,
  REACT_PROFILE,
  GENERIC_PROFILE,
  getProfile,
} from "./profiles.js";

// ─────────────────────────────────────────────
// Stack Auto-Detector
//
// Phát hiện framework từ project root bằng cách
// kiểm tra file đặc trưng (marker files).
//
// Priority order:
//   1. angular.json → Angular
//   2. pubspec.yaml → Flutter
//   3. nest-cli.json hoặc @nestjs/core → NestJS
//   4. pom.xml hoặc build.gradle → Spring
//   5. next.config.* hoặc react → React
//   6. Fallback → Generic
// ─────────────────────────────────────────────

interface DetectionRule {
  stackName: StackName;
  markerFiles: string[];
  /** Kiểm tra trong package.json nếu marker file không tồn tại */
  packageJsonDeps?: string[];
}

const DETECTION_RULES: DetectionRule[] = [
  {
    stackName: "angular",
    markerFiles: ["angular.json", ".angular.json"],
  },
  {
    stackName: "flutter",
    markerFiles: ["pubspec.yaml", "pubspec.yml"],
  },
  {
    stackName: "nestjs",
    markerFiles: ["nest-cli.json"],
    packageJsonDeps: ["@nestjs/core"],
  },
  {
    stackName: "spring",
    markerFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
  },
  {
    stackName: "react",
    markerFiles: ["next.config.js", "next.config.ts", "next.config.mjs"],
    packageJsonDeps: ["react", "next"],
  },
];

/**
 * Resolve StackProfile từ user input hoặc auto-detect.
 *
 * - Nếu stackName là một tên cụ thể (angular, spring...) → trả về profile tương ứng
 * - Nếu stackName là "auto" hoặc undefined → auto-detect từ projectRoot
 * - Nếu không detect được → trả về GENERIC_PROFILE
 *
 * @param stackName - "auto" | "angular" | "spring" | "nestjs" | "flutter" | "react" | "generic"
 * @param projectRoot - Đường dẫn tuyệt đối đến project root (dùng cho auto-detect)
 */
export async function resolveStackProfile(
  stackName?: string,
  projectRoot?: string,
): Promise<StackProfile> {
  // Case 1: User chỉ định rõ stack
  if (stackName && stackName !== "auto") {
    return getProfile(stackName);
  }

  // Case 2: Auto-detect từ project root
  if (projectRoot) {
    return await detectStack(projectRoot);
  }

  // Case 3: Không có thông tin → generic
  return GENERIC_PROFILE;
}

/**
 * Auto-detect framework từ các marker files trong project root.
 */
async function detectStack(projectRoot: string): Promise<StackProfile> {
  for (const rule of DETECTION_RULES) {
    // Kiểm tra marker files
    for (const marker of rule.markerFiles) {
      const markerPath = path.join(projectRoot, marker);
      if (await fileExists(markerPath)) {
        return getProfile(rule.stackName);
      }
    }

    // Kiểm tra package.json dependencies
    if (rule.packageJsonDeps && rule.packageJsonDeps.length > 0) {
      const packageJsonPath = path.join(projectRoot, "package.json");
      if (await fileExists(packageJsonPath)) {
        try {
          const raw = await fs.readFile(packageJsonPath, "utf-8");
          const pkg = JSON.parse(raw);
          const allDeps = {
            ...(pkg.dependencies ?? {}),
            ...(pkg.devDependencies ?? {}),
          };

          const hasMatchingDep = rule.packageJsonDeps.some(
            (dep) => dep in allDeps
          );
          if (hasMatchingDep) {
            return getProfile(rule.stackName);
          }
        } catch {
          // package.json parse failed → bỏ qua
        }
      }
    }
  }

  // Không match rule nào → generic
  return GENERIC_PROFILE;
}

/**
 * Kiểm tra file tồn tại (không throw)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
