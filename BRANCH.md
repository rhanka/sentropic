# Feature: chat-ui MessageActions P2 (additive lib export)

## Objective
Add a reusable `MessageActions` Svelte component and `message-actions` pure-logic util to `@sentropic/chat-ui` as new additive exports. Librarizes the message-action row (copy/edit/regenerate/retry/feedback) currently inline in `AppChatPanel.svelte` (handlers at lines 2884-2911, 2975-3000, 3081-3099, 3101-3108, 4409-4423; markup at lines 5095-5138 [user row] and 5181-5244 [assistant row] on main). Comment copy/edit (`startEditComment`, `editingCommentId`) and checkpoint-restore logic stay app-owned. No app changes, no headless-core, no Makefile changes.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/` new files and manifest/package.json additions.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) — must remain stable.
- Branch development in isolated worktree `tmp/feat-chatui-message-actions-p2`.
- Automated test campaigns on dedicated environments, never root `dev`.
- `ENV=<env>` as last argument in all `make` commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/MessageActions.svelte` (new)
  - `packages/chat-ui/src/components/MessageActions.svelte.d.ts` (new)
  - `packages/chat-ui/src/utils/message-actions.ts` (new)
  - `packages/chat-ui/package.json` (ADD two new exports subpaths + bump version minor)
  - `packages/chat-ui/export-manifest.json` (ADD two new subpaths — additive only)
  - `packages/chat-ui/tests/message-actions.spec.ts` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**` (app retrofit is a separate later branch)
  - All other packages
- **Conditional Paths**: none required
- **Exception process**: none needed (no conditional paths touched)

## Feedback Loop
- `deferred` (A0b-DOM): DOM/render tests for MessageActions.svelte deferred to `feat/chatui-a0b-dom-visual-harness` (A0b jsdom harness). Component covered by typecheck for now. Owner: Wave A plan.

## AI Flaky tests
- N/A (no AI tests in this branch)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (additive lib-only; single gate cycle)
- Rationale: single orthogonal additive task, no service stack needed.

## UAT Management (in orchestration context)
- Mono-branch: no UI UAT (lib-only additive; no app changes in this branch).
- Gates are local `make` commands only (typecheck + build + pack + test).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules files and spec (workflow, MASTER, subagents, testing, SPEC_EVOL_CHATUI_WAVE_A §4 P2).
  - [x] Confirm worktree on `feat/chatui-message-actions-p2`.
  - [x] Confirm export manifest + existing tests (A0a gates must stay green).
  - [x] Re-derive AppChatPanel.svelte message-action sub-ranges on main: handlers at lines 2884-2911 (startEditMessage/cancelEditMessage/saveEditMessage), 2975-3000 (retryMessage), 3081-3099 (retryFromAssistant), 3101-3108 (markCopied/isCopied), 4409-4423 (setFeedback); markup at lines 5095-5138 (user row) and 5181-5244 (assistant row).
  - [x] Confirmed excluded: startEditComment/editingCommentId (line 2384+), checkpoint/pendingCheckpoint logic (lines 3002-3079).
  - [x] Define scope: no dev stack needed (pure lib, node tests only).

- [x] **Lot 1 — Pure logic util + component + exports + tests**
  - [x] Write `packages/chat-ui/src/utils/message-actions.ts`: types + available-actions resolver, feedback-vote toggle logic, copy-payload helpers.
  - [x] Write `packages/chat-ui/src/components/MessageActions.svelte`: presentational action row for user/assistant messages, i18n resolver, injected callbacks.
  - [x] Write `packages/chat-ui/src/components/MessageActions.svelte.d.ts`: props type + default export.
  - [x] Bump `packages/chat-ui/package.json` version to `0.3.0` (minor — new feature).
  - [x] Add two export subpaths to `packages/chat-ui/package.json` exports map.
  - [x] Add two subpath entries to `packages/chat-ui/export-manifest.json` (additive, no existing entries touched).
  - [x] Write `packages/chat-ui/tests/message-actions.spec.ts`: resolveAvailableActions, toggleFeedbackVote, formatCopyPayload, buildFeedbackNextVote — node env.
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` — PASS
    - [x] `make build-chat-ui` — PASS
    - [x] `make pack-chat-ui` — PASS
    - [x] `make test-chat-ui` — PASS (A0a export-surface + projection-golden + model-selection + new message-actions tests)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec EVOL file to integrate (SPEC_EVOL_CHATUI_WAVE_A.md lives in spec/ and is the Wave A master spec — do not delete).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck: `make typecheck-chat-ui`
  - [ ] Build: `make build-chat-ui`
  - [ ] Pack: `make pack-chat-ui`
  - [ ] Test: `make test-chat-ui`
  - [ ] Version bumped: `packages/chat-ui/package.json` → `0.3.0` (minor, new exports added).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR.
  - [ ] Final gate step 3: once CI OK, commit removal of `BRANCH.md`, push, merge.
