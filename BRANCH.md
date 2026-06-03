# Feature: App retrofit P7 — consume @sentropic/chat-ui/utils/markdown-refs

## Objective
Make the sentropic app's `renderMarkdownWithRefs` a thin host wrapper that delegates to the published `@sentropic/chat-ui/utils/markdown-refs` (P7), injecting the app's `marked` + keeping app-owned DOMPurify sanitization, and delete the now-duplicated internal logic. Behavior-preserving (identical HTML output); zero dual paths.

## Scope / Guardrails
- Scope limited to `ui/src/lib/utils/markdown.ts` (+ its UI tests if any).
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/chatui-app-retrofit`.
- Automated tests run on dedicated env `ENV=test` / `ENV=e2e-feat-chatui-p7`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/utils/markdown.ts`
  - `ui/tests/**` (only markdown-related TS tests if they must adapt)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**` (lib already ships P7 at 0.9.0 — no lib change)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - `ui/src/lib/components/**`, `ui/src/routes/**` (only if a caller import must change — expected NONE since the wrapper stays in `$lib/utils/markdown`)
- **Exception process**:
  - Declare exception ID `BR-P7-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network nondeterminism as `flaky accepted`; never add timeouts; document signature + user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal change; single test cycle)
- [ ] **Multi-branch**
- Rationale: One file, behavior-preserving dedup; no independent sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only. P7 is behavior-preserving (identical rendered HTML); visual non-regression covered by existing UI/e2e tests + a quick render spot-check.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/chatui-app-retrofit` on branch `feat/chatui-app-retrofit-p7` confirmed.
  - [x] Env mapping: `ENV=feat-chatui-p7`; ports API `9300`, UI `5400`, MAILDEV_UI `1300`.
  - [x] Confirm scope: only `ui/src/lib/utils/markdown.ts` changes (wrapper stays in `$lib/utils/markdown`, so callers unchanged).
  - [x] Confirm which internal helpers in `markdown.ts` are referenced only by `renderMarkdownWithRefs` (safe to delete) vs used elsewhere (keep): all helpers KEPT — no deletion needed since no internal logic was duplicated beyond what the lib now owns inside `renderMarkdownWithRefs`.

- [x] **Lot 1 — Delegate renderMarkdownWithRefs to the library**
  - [x] Rewrote `renderMarkdownWithRefs(text, references?, options?)` in `ui/src/lib/utils/markdown.ts` to call `libRenderMarkdownWithRefs` from `@sentropic/chat-ui/utils/markdown-refs`, injecting the app's `marked`-based `markdownToHtml` and passing `createReferenceLink` as `renderRef`; then runs result through the app's `sanitizeHtml` (DOMPurify). Exported signature unchanged.
  - [x] Duplicated internals (normalize, placeholder logic, CSS injection) removed from app — now owned by the library. KEPT: `arrayToMarkdown`, `markdownToArray`, `renderInlineMarkdown`, `parseReferencesInMarkdown`, `sanitizeHtml`, `createReferenceLink`, `normalizeUseCaseMarkdown`, `normalizeMarkdownLineEndings`, `stripTrailingEmptyParagraph` (all used by other callers).
  - [x] All callers (`AppChatPanel.svelte`, `dashboard/+page.svelte`, `InitiativeDetail.svelte`, `ScoreTable.svelte`, `TemplateRenderer.svelte`) unchanged — symbol still in `$lib/utils/markdown`.
  - [x] Lot gate:
    - [x] `make typecheck-ui API_PORT=9300 UI_PORT=5400 MAILDEV_UI_PORT=1300 ENV=feat-chatui-p7` — 0 errors, 6 pre-existing warnings
    - [x] `make lint-ui API_PORT=9300 UI_PORT=5400 MAILDEV_UI_PORT=1300 ENV=feat-chatui-p7` — exit 0, no errors
    - [x] `make test-ui SCOPE=tests/utils/markdown.test.ts ENV=test-feat-chatui-p7` — 12/12 passed; `todo-chat-rendering.test.ts` — 3/3 passed; equivalence spec 13/13 passed (baseline vs new: identical)
    - [x] `make build-ui-image API_PORT=9300 UI_PORT=5400 MAILDEV_UI_PORT=1300 ENV=feat-chatui-p7` — PASS
    - [x] **E2E**: deferred to PR CI (chat e2e group 03); behavior-preserving change. Pre-existing `google-drive-picker.test.ts` failure (2 tests) exists on baseline (before this branch); not introduced by this change.

- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint (`make typecheck-ui` + `make lint-ui ENV=feat-chatui-p7`) — PASS
  - [x] `make test-ui ENV=test-feat-chatui-p7` — markdown tests PASS
  - [x] No `packages/**` change → no chat-ui version bump required (`enforce-package-bump` not triggered).
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` as PR body.
  - [ ] Final gate step 2: branch CI green on the PR (ALL checks, incl. e2e — never merge red).
  - [ ] Final gate step 3: once CI green, commit removal of `BRANCH.md`, push, merge.
