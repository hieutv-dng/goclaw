// ─────────────────────────────────────────────
// StackProfile — Cấu hình framework-specific
//
// Mỗi profile chứa toàn bộ thông tin cần thiết
// để các tools (codebase, scorer, gwt, security...)
// hoạt động đúng với từng tech stack.
//
// 6 profiles sẵn có:
//   angular, spring, nestjs, flutter, react, generic
// ─────────────────────────────────────────────

export interface StackProfile {
  /** ID duy nhất — dùng để truyền qua tool param */
  name: string;
  /** Tên hiển thị cho user */
  displayName: string;

  // ── File scanning ──────────────────────────

  /** Extensions cần scan (VD: [".ts", ".html", ".scss"]) */
  extensions: string[];
  /** Folders cần bỏ qua khi walk directory */
  ignorePatterns: string[];

  // ── Scoring ────────────────────────────────

  /** Điểm ưu tiên theo file type suffix (VD: ".service.ts": 22) */
  fileTypeScores: Record<string, number>;
  /** Task keywords → file patterns cần boost */
  taskPatterns: Array<{
    taskKeywords: string[];
    boostFilePatterns: string[];
    score: number;
  }>;

  // ── Language mapping ───────────────────────

  /** Extension → language name cho code block formatting */
  langMap: Record<string, string>;

  // ── Prompts context ────────────────────────

  promptContext: {
    /** VD: "Angular frontend project" | "Spring Boot backend" */
    role: string;
    /** VD: "Angular frontend security" | "Spring Security" */
    securityFocus: string;
    /** VD: "Angular style guide" | "Spring Boot conventions" */
    styleGuide: string;
  };

  // ── Project structure ──────────────────────

  projectStructure: {
    /** VD: "src/app" | "src/main/java" | "lib" */
    srcPattern: string;
    /** VD: "apps" | "modules" */
    appsFolderDefault: string;
    /** VD: "libs" | "common" */
    libsFolderDefault: string;
  };
}

// ── Danh sách tên stack hỗ trợ ────────────────
export type StackName = "angular" | "spring" | "nestjs" | "flutter" | "react" | "generic" | "auto";

// ── Ignore patterns chung cho mọi framework ──
const COMMON_IGNORE = [
  "node_modules", ".git", "coverage", ".nyc_output",
  "__pycache__", ".cache", "tmp", "temp",
];

// ═══════════════════════════════════════════════
// 1. ANGULAR
// ═══════════════════════════════════════════════
export const ANGULAR_PROFILE: StackProfile = {
  name: "angular",
  displayName: "Angular 17+",

  extensions: [".ts", ".html", ".scss", ".css"],
  ignorePatterns: [...COMMON_IGNORE, ".angular", "dist"],

  fileTypeScores: {
    ".facade.ts":     25,
    ".service.ts":    22,
    ".component.ts":  20,
    ".component.html": 15,
    ".directive.ts":  14,
    ".pipe.ts":       14,
    ".store.ts":      18,
    ".effect.ts":     16,
    ".reducer.ts":    16,
    ".selector.ts":   14,
    ".guard.ts":      12,
    ".interceptor.ts": 12,
    ".resolver.ts":   10,
    ".module.ts":     8,
    ".routes.ts":     8,
    ".model.ts":      10,
    ".interface.ts":  10,
    ".types.ts":      10,
    ".constants.ts":  6,
    ".spec.ts":       2,
    ".scss":          3,
  },

  taskPatterns: [
    {
      taskKeywords: ["form", "input", "validate", "submit", "field", "control"],
      boostFilePatterns: [".component.ts", ".component.html", "form"],
      score: 10,
    },
    {
      taskKeywords: ["api", "http", "request", "endpoint", "backend", "call"],
      boostFilePatterns: [".service.ts", "api", "http", "client"],
      score: 10,
    },
    {
      taskKeywords: ["route", "navigate", "redirect", "guard", "lazy"],
      boostFilePatterns: [".guard.ts", ".routes.ts", ".module.ts", "routing"],
      score: 10,
    },
    {
      taskKeywords: ["state", "store", "ngrx", "akita", "signal"],
      boostFilePatterns: [".store.ts", ".reducer.ts", ".effect.ts", ".selector.ts", ".facade.ts"],
      score: 10,
    },
    {
      taskKeywords: ["auth", "login", "token", "permission", "role"],
      boostFilePatterns: ["auth", ".guard.ts", ".interceptor.ts", "token"],
      score: 10,
    },
    {
      taskKeywords: ["list", "table", "paginate", "filter", "sort", "search"],
      boostFilePatterns: [".component.ts", ".component.html", "list", "table"],
      score: 8,
    },
    {
      taskKeywords: ["modal", "dialog", "popup", "overlay"],
      boostFilePatterns: ["modal", "dialog", ".component.ts"],
      score: 8,
    },
  ],

  langMap: {
    ".ts": "typescript", ".html": "html", ".scss": "scss",
    ".css": "css", ".json": "json", ".js": "javascript", ".md": "markdown",
  },

  promptContext: {
    role: "Angular frontend project",
    securityFocus: "Angular frontend security (XSS, DomSanitizer, CSRF, Auth Guards)",
    styleGuide: "Angular style guide",
  },

  projectStructure: {
    srcPattern: "src/app",
    appsFolderDefault: "apps",
    libsFolderDefault: "libs",
  },
};

// ═══════════════════════════════════════════════
// 2. SPRING BOOT
// ═══════════════════════════════════════════════
export const SPRING_PROFILE: StackProfile = {
  name: "spring",
  displayName: "Spring Boot 3.x (Java/Kotlin)",

  extensions: [".java", ".kt", ".xml", ".yml", ".yaml", ".properties"],
  ignorePatterns: [...COMMON_IGNORE, "target", "build", ".gradle", ".mvn", ".idea"],

  fileTypeScores: {
    "Controller.java":  22,
    "Service.java":     25,
    "ServiceImpl.java": 22,
    "Repository.java":  20,
    "Entity.java":      18,
    "Dto.java":         15,
    "Config.java":      14,
    "Filter.java":      12,
    "Interceptor.java": 12,
    "Mapper.java":      10,
    "Exception.java":   8,
    "Util.java":        6,
    "Test.java":        2,
    // Kotlin variants
    "Controller.kt":    22,
    "Service.kt":       25,
    "Repository.kt":    20,
    "Entity.kt":        18,
  },

  taskPatterns: [
    {
      taskKeywords: ["api", "endpoint", "rest", "controller", "request", "response"],
      boostFilePatterns: ["Controller", "RestController", "api", "endpoint"],
      score: 10,
    },
    {
      taskKeywords: ["database", "entity", "table", "jpa", "query", "repository"],
      boostFilePatterns: ["Repository", "Entity", "Dao", "jpa"],
      score: 10,
    },
    {
      taskKeywords: ["auth", "login", "token", "jwt", "security", "permission"],
      boostFilePatterns: ["Security", "Auth", "Filter", "jwt", "token"],
      score: 10,
    },
    {
      taskKeywords: ["service", "business", "logic", "process", "calculate"],
      boostFilePatterns: ["Service", "ServiceImpl", "Facade"],
      score: 10,
    },
    {
      taskKeywords: ["config", "property", "environment", "profile", "bean"],
      boostFilePatterns: ["Config", "Properties", "Configuration", ".yml", ".yaml"],
      score: 8,
    },
    {
      taskKeywords: ["dto", "mapper", "convert", "transform", "response"],
      boostFilePatterns: ["Dto", "Mapper", "Converter", "Response"],
      score: 8,
    },
  ],

  langMap: {
    ".java": "java", ".kt": "kotlin", ".xml": "xml",
    ".yml": "yaml", ".yaml": "yaml", ".properties": "properties",
    ".json": "json", ".md": "markdown",
  },

  promptContext: {
    role: "Spring Boot backend project (Java/Kotlin)",
    securityFocus: "Spring Security (JWT, OAuth2, CORS, CSRF, SQL Injection, Input Validation)",
    styleGuide: "Spring Boot conventions và Java/Kotlin coding standards",
  },

  projectStructure: {
    srcPattern: "src/main/java",
    appsFolderDefault: "modules",
    libsFolderDefault: "common",
  },
};

// ═══════════════════════════════════════════════
// 3. NESTJS
// ═══════════════════════════════════════════════
export const NESTJS_PROFILE: StackProfile = {
  name: "nestjs",
  displayName: "NestJS (Node.js + TypeScript)",

  extensions: [".ts", ".json"],
  ignorePatterns: [...COMMON_IGNORE, "dist", "node_modules"],

  fileTypeScores: {
    ".controller.ts":  22,
    ".service.ts":     25,
    ".module.ts":      10,
    ".guard.ts":       14,
    ".interceptor.ts": 12,
    ".middleware.ts":  12,
    ".pipe.ts":        10,
    ".filter.ts":      10,
    ".decorator.ts":   8,
    ".dto.ts":         15,
    ".entity.ts":      18,
    ".schema.ts":      16,
    ".repository.ts":  20,
    ".gateway.ts":     14,
    ".interface.ts":   10,
    ".types.ts":       10,
    ".constants.ts":   6,
    ".spec.ts":        2,
  },

  taskPatterns: [
    {
      taskKeywords: ["api", "endpoint", "rest", "controller", "request", "response"],
      boostFilePatterns: [".controller.ts", "api", "endpoint"],
      score: 10,
    },
    {
      taskKeywords: ["database", "entity", "schema", "typeorm", "prisma", "mongoose"],
      boostFilePatterns: [".entity.ts", ".schema.ts", ".repository.ts", "migration"],
      score: 10,
    },
    {
      taskKeywords: ["auth", "login", "token", "jwt", "passport", "guard"],
      boostFilePatterns: [".guard.ts", "auth", "jwt", "passport", "strategy"],
      score: 10,
    },
    {
      taskKeywords: ["websocket", "socket", "gateway", "realtime", "event"],
      boostFilePatterns: [".gateway.ts", "socket", "event"],
      score: 10,
    },
    {
      taskKeywords: ["validate", "dto", "pipe", "transform"],
      boostFilePatterns: [".dto.ts", ".pipe.ts", "validate"],
      score: 8,
    },
  ],

  langMap: {
    ".ts": "typescript", ".json": "json", ".js": "javascript", ".md": "markdown",
  },

  promptContext: {
    role: "NestJS backend project (TypeScript)",
    securityFocus: "NestJS security (Guards, Helmet, CORS, Rate Limiting, Input Validation, JWT)",
    styleGuide: "NestJS conventions và TypeScript coding standards",
  },

  projectStructure: {
    srcPattern: "src",
    appsFolderDefault: "apps",
    libsFolderDefault: "libs",
  },
};

// ═══════════════════════════════════════════════
// 4. FLUTTER
// ═══════════════════════════════════════════════
export const FLUTTER_PROFILE: StackProfile = {
  name: "flutter",
  displayName: "Flutter (Dart)",

  extensions: [".dart", ".yaml", ".yml"],
  ignorePatterns: [...COMMON_IGNORE, ".dart_tool", "build", ".flutter-plugins", ".flutter-plugins-dependencies", "ios", "android", "web", "macos", "windows", "linux"],

  fileTypeScores: {
    "_screen.dart":     20,
    "_page.dart":       20,
    "_service.dart":    22,
    "_repository.dart": 20,
    "_provider.dart":   18,
    "_controller.dart": 18,
    "_bloc.dart":       18,
    "_cubit.dart":      18,
    "_state.dart":      16,
    "_event.dart":      14,
    "_model.dart":      15,
    "_entity.dart":     15,
    "_widget.dart":     14,
    "_utils.dart":      6,
    "_constants.dart":  6,
    "_test.dart":       2,
    "pubspec.yaml":     4,
  },

  taskPatterns: [
    {
      taskKeywords: ["screen", "page", "ui", "layout", "widget", "view"],
      boostFilePatterns: ["_screen.dart", "_page.dart", "_widget.dart", "_view.dart"],
      score: 10,
    },
    {
      taskKeywords: ["api", "http", "request", "dio", "retrofit", "network"],
      boostFilePatterns: ["_service.dart", "_repository.dart", "api", "http", "client"],
      score: 10,
    },
    {
      taskKeywords: ["state", "bloc", "cubit", "provider", "riverpod", "getx"],
      boostFilePatterns: ["_bloc.dart", "_cubit.dart", "_provider.dart", "_state.dart", "_event.dart"],
      score: 10,
    },
    {
      taskKeywords: ["model", "entity", "json", "serialization", "freezed"],
      boostFilePatterns: ["_model.dart", "_entity.dart", ".g.dart", ".freezed.dart"],
      score: 8,
    },
    {
      taskKeywords: ["route", "navigate", "navigation", "router", "go_router"],
      boostFilePatterns: ["router", "route", "navigation"],
      score: 8,
    },
    {
      taskKeywords: ["auth", "login", "token", "permission"],
      boostFilePatterns: ["auth", "login", "token"],
      score: 10,
    },
  ],

  langMap: {
    ".dart": "dart", ".yaml": "yaml", ".yml": "yaml",
    ".json": "json", ".md": "markdown",
  },

  promptContext: {
    role: "Flutter mobile/web project (Dart)",
    securityFocus: "Flutter security (Secure Storage, SSL Pinning, API Key Protection, Obfuscation)",
    styleGuide: "Dart/Flutter conventions và Effective Dart",
  },

  projectStructure: {
    srcPattern: "lib",
    appsFolderDefault: "lib/features",
    libsFolderDefault: "lib/core",
  },
};

// ═══════════════════════════════════════════════
// 5. REACT / NEXT.JS
// ═══════════════════════════════════════════════
export const REACT_PROFILE: StackProfile = {
  name: "react",
  displayName: "React / Next.js (TypeScript)",

  extensions: [".tsx", ".ts", ".jsx", ".js", ".css", ".scss"],
  ignorePatterns: [...COMMON_IGNORE, ".next", "out", "build", "dist", ".vercel"],

  fileTypeScores: {
    ".page.tsx":     20,
    ".page.ts":      20,
    ".hook.ts":      22,
    ".hook.tsx":     22,
    ".api.ts":       22,
    ".service.ts":   20,
    ".context.tsx":  18,
    ".provider.tsx": 16,
    ".store.ts":     18,
    ".slice.ts":     16,
    ".component.tsx": 15,
    ".utils.ts":     8,
    ".types.ts":     10,
    ".constants.ts": 6,
    ".test.tsx":     2,
    ".test.ts":      2,
    ".spec.ts":      2,
    ".css":          3,
    ".scss":         3,
    ".module.css":   4,
  },

  taskPatterns: [
    {
      taskKeywords: ["page", "route", "layout", "view", "screen"],
      boostFilePatterns: [".page.tsx", "page.tsx", "layout.tsx", "[", "route"],
      score: 10,
    },
    {
      taskKeywords: ["api", "fetch", "request", "endpoint", "server", "action"],
      boostFilePatterns: [".api.ts", ".service.ts", "api/", "actions/", "server"],
      score: 10,
    },
    {
      taskKeywords: ["state", "store", "redux", "zustand", "context", "provider"],
      boostFilePatterns: [".store.ts", ".slice.ts", ".context.tsx", ".provider.tsx"],
      score: 10,
    },
    {
      taskKeywords: ["hook", "custom", "use"],
      boostFilePatterns: [".hook.ts", ".hook.tsx", "use"],
      score: 10,
    },
    {
      taskKeywords: ["component", "ui", "button", "modal", "form", "input"],
      boostFilePatterns: [".component.tsx", "components/", "ui/"],
      score: 8,
    },
    {
      taskKeywords: ["auth", "login", "session", "middleware"],
      boostFilePatterns: ["auth", "middleware", "session", "login"],
      score: 10,
    },
  ],

  langMap: {
    ".tsx": "tsx", ".ts": "typescript", ".jsx": "jsx", ".js": "javascript",
    ".css": "css", ".scss": "scss", ".json": "json", ".md": "markdown",
  },

  promptContext: {
    role: "React/Next.js frontend project (TypeScript)",
    securityFocus: "React security (XSS via dangerouslySetInnerHTML, CSRF, Server Actions, Auth Middleware)",
    styleGuide: "React/Next.js conventions và TypeScript coding standards",
  },

  projectStructure: {
    srcPattern: "src",
    appsFolderDefault: "apps",
    libsFolderDefault: "packages",
  },
};

// ═══════════════════════════════════════════════
// 6. GENERIC (Fallback)
// ═══════════════════════════════════════════════
export const GENERIC_PROFILE: StackProfile = {
  name: "generic",
  displayName: "Generic Project",

  extensions: [".ts", ".js", ".py", ".java", ".kt", ".dart", ".go", ".rs", ".tsx", ".jsx", ".html", ".css", ".scss"],
  ignorePatterns: [...COMMON_IGNORE, "dist", "build", "target", "out"],

  fileTypeScores: {},

  taskPatterns: [
    {
      taskKeywords: ["api", "http", "request", "endpoint"],
      boostFilePatterns: ["api", "service", "client", "http", "controller"],
      score: 8,
    },
    {
      taskKeywords: ["auth", "login", "token", "permission"],
      boostFilePatterns: ["auth", "login", "token", "security"],
      score: 8,
    },
    {
      taskKeywords: ["test", "spec", "coverage"],
      boostFilePatterns: ["test", "spec", "__tests__"],
      score: 5,
    },
  ],

  langMap: {
    ".ts": "typescript", ".js": "javascript", ".py": "python",
    ".java": "java", ".kt": "kotlin", ".dart": "dart",
    ".go": "go", ".rs": "rust", ".tsx": "tsx", ".jsx": "jsx",
    ".html": "html", ".css": "css", ".scss": "scss",
    ".json": "json", ".md": "markdown", ".xml": "xml",
    ".yml": "yaml", ".yaml": "yaml",
  },

  promptContext: {
    role: "software project",
    securityFocus: "application security (OWASP Top 10, Input Validation, Authentication, Authorization)",
    styleGuide: "coding conventions của project",
  },

  projectStructure: {
    srcPattern: "src",
    appsFolderDefault: "apps",
    libsFolderDefault: "libs",
  },
};

// ── Profile registry ─────────────────────────
export const STACK_PROFILES: Record<string, StackProfile> = {
  angular: ANGULAR_PROFILE,
  spring: SPRING_PROFILE,
  nestjs: NESTJS_PROFILE,
  flutter: FLUTTER_PROFILE,
  react: REACT_PROFILE,
  generic: GENERIC_PROFILE,
};

/**
 * Lấy profile theo tên. Fallback về generic nếu không tìm thấy.
 */
export function getProfile(name: string): StackProfile {
  return STACK_PROFILES[name] ?? GENERIC_PROFILE;
}
