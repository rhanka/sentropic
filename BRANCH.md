# Feature: chat-ui P7 — portable renderMarkdownWithRefs util

## Objective
Extract the portable core of `renderMarkdownWithRefs` (citation/ref markdown rendering) from `ui/src/lib/utils/markdown.ts` into `@sentropic/chat-ui/utils/markdown-refs` as an additive export, so sibling apps (radar) can render citations identically. Lib-only, additive, no app changes.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/utils/markdown-refs.ts`, `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/tests/markdown-refs.spec.ts`, `BRANCH.md`.
- No app changes (`ui/src/**` untouched — app retrofit is a separate Tier-1 step).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/feat-chatui-markdown-refs-p7`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/utils/markdown-refs.ts` (new — portable core)
  - `packages/chat-ui/package.json` (ADD export + bump version 0.4.0 → 0.5.0)
  - `packages/chat-ui/export-manifest.json` (REGISTER new export — additive only)
  - `packages/chat-ui/tests/markdown-refs.spec.ts` (new, node env)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**` (app retrofit deferred)
  - All other packages
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - (none declared)

## Feedback Loop
- `deferred`: app retrofit of `ui/src/lib/utils/markdown.ts` to consume `@sentropic/chat-ui/utils/markdown-refs` is Tier-1 (separate branch). Current app file is untouched.

## AI Flaky tests
- None applicable (no AI tests in this branch).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single additive lib change, no orchestration needed)
- [ ] **Multi-branch**
- Rationale: Single orthogonal lib-only change with no dependencies.

## UAT Management (in orchestration context)
- Lib-only (Tier-0): no UAT required. App retrofit (Tier-1) is a separate branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules (MASTER.md, workflow.md, subagents.md, testing.md).
  - [x] Verify worktree on correct branch `feat/chatui-markdown-refs-p7`.
  - [x] Read `ui/src/lib/utils/markdown.ts` to assess portability.
  - [x] Read `packages/chat-ui/src/utils/model-selection.ts` as additive pattern template.
  - [x] Read `packages/chat-ui/package.json` + `export-manifest.json`.
  - [x] Read `spec/SPEC_EVOL_CHATUI_WAVE_A.md` §4 P7.
  - [x] Confirm scope boundaries.

- [x] **Lot 1 — Portable util + export + tests**
  - [x] Assess portability of `renderMarkdownWithRefs`: has `DOMPurify` (browser-only, requires `window`) — NOT directly portable; inject `markdownToHtml` and `renderRef` as callbacks so lib has zero runtime deps and no browser coupling.
  - [x] Create `packages/chat-ui/src/utils/markdown-refs.ts` with: `normalizeMarkdownLineEndings`, `normalizeUseCaseMarkdown`, `stripTrailingEmptyParagraph`, `createDefaultRefLink`, `renderMarkdownWithRefs`, types `Reference`, `RenderMarkdownOptions`, `RefLinkRenderer`, `MarkdownToHtmlFn`.
  - [x] ADD `./utils/markdown-refs` export to `packages/chat-ui/package.json`.
  - [x] Bump version `0.4.0` → `0.5.0` in `packages/chat-ui/package.json`.
  - [x] REGISTER `./utils/markdown-refs` subpath in `packages/chat-ui/export-manifest.json`.
  - [x] Create `packages/chat-ui/tests/markdown-refs.spec.ts` (38 tests, node env).
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` — PASS
    - [x] `make build-chat-ui` && `make pack-chat-ui` — PASS (dist/utils/markdown-refs.* in tarball, version 0.5.0)
    - [x] `make test-chat-ui ENV=test-chatui-markdown-refs` — PASS (295 tests: 38 new + 257 existing)

- [x] **Lot N — Final validation**
  - [x] All 4 gates green (see above).
  - [x] Existing exports + tests unchanged (only additive).
  - [x] No `$lib` / app coupling pulled into the lib (zero browser imports; `marked` and `DOMPurify` injected by caller).
  - [x] Version bump: `chat-ui@0.5.0` (minor, new feature export).
  - [x] Final gate: create PR using BRANCH.md text as PR body.
