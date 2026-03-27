# Multi-Framework Support — Walkthrough

## Tổng kết

Chuyển vnpt-dev-agent từ Angular-only thành hỗ trợ **6 framework**: Angular, Spring Boot, NestJS, Flutter, React/Next.js, và Generic fallback.

## Changes Made

### Session 1: Core Stack Profile System

| File | Action | Key Changes |
|---|---|---|
| [profiles.ts](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/profiles.ts) | 🆕 NEW | [StackProfile](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/profiles.ts#12-63) interface + 6 presets (extensions, ignore, scores, patterns, langMap, prompts) |
| [resolver.ts](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/resolver.ts) | 🆕 NEW | Auto-detect from marker files (angular.json, pom.xml, pubspec.yaml, nest-cli.json, next.config.*) |
| [index.ts](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/index.ts) | 🆕 NEW | Barrel export |
| [reader.ts](file:///d:/learn/vnpt-dev-agent/src/codebase/reader.ts) | ✏️ MOD | [CodebaseReader](file:///d:/learn/vnpt-dev-agent/src/codebase/reader.ts#48-327) accepts [StackProfile](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/profiles.ts#12-63) via constructor — replaced hardcoded extensions, ignore, langMap |
| [scorer.ts](file:///d:/learn/vnpt-dev-agent/src/codebase/scorer.ts) | ✏️ MOD | [SmartScorer](file:///d:/learn/vnpt-dev-agent/src/codebase/scorer.ts#51-208) uses `profile.fileTypeScores` + `profile.taskPatterns` — renamed `angularPattern` → `frameworkPattern` |
| [tools.ts](file:///d:/learn/vnpt-dev-agent/src/codebase/tools.ts) | ✏️ MOD | All 5 tools have new `stack` param — auto-resolves via [resolveStackProfile()](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/resolver.ts#62-89) |

### Session 2: Prompt & Peripheral Updates

| File | Action | Key Changes |
|---|---|---|
| [gwt/tools.ts](file:///d:/learn/vnpt-dev-agent/src/gwt/tools.ts) | ✏️ MOD | "Angular frontend project" → "software project" |
| [security/tools.ts](file:///d:/learn/vnpt-dev-agent/src/security/tools.ts) | ✏️ MOD | "Angular frontend security" → "application security" |
| [team-context/tools.ts](file:///d:/learn/vnpt-dev-agent/src/team-context/tools.ts) | ✏️ MOD | "Angular style guide" → "style guide mặc định của framework" |
| [gen-logwork/tools.ts](file:///d:/learn/vnpt-dev-agent/src/gen-logwork/tools.ts) | ✏️ MOD | Uses [StackProfile](file:///d:/learn/vnpt-dev-agent/src/stack-profiles/profiles.ts#12-63) for file scanning + new `stack` param |

## Verification

- ✅ `npx tsc --noEmit` — **0 errors** (Session 1)
- ✅ `npx tsc --noEmit` — **0 errors** (Session 2)
- ✅ Backward compatible: `stack: "auto"` default → Angular projects behave identically
- ✅ [index.ts](file:///d:/learn/vnpt-dev-agent/src/index.ts) requires no changes — tools self-configure via StackProfile

## How It Works

```
User gọi tool (VD: find_by_name)
      │
      ▼
stack = "auto"  ─── resolveStackProfile("auto", projectRoot)
      │
      ▼
detectStack() kiểm tra marker files:
  - angular.json?   → Angular Profile
  - pom.xml?         → Spring Profile
  - pubspec.yaml?    → Flutter Profile
  - nest-cli.json?   → NestJS Profile
  - next.config.*?   → React Profile
  - Không match?     → Generic Profile
      │
      ▼
Profile được inject vào CodebaseReader / SmartScorer
→ Tìm đúng extensions, ignore đúng folders, score đúng file types
```
