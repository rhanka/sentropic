# Feature: chat-ui checkpoints module (Lot 2)

## Objective
Extract checkpoint classification and session state into `packages/chat-ui/src/checkpoints/` (pure TS, zero domain strings). Bind sentropic-specific logic (URL helpers, domain tool suffixes, local tool name guard, humanize label) in `ui/src/lib/adapters/checkpointHostAdapter.ts`. Delete `ui/src/lib/utils/checkpointDelta.ts`.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/checkpoints/**`, `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/tests/checkpoints.spec.ts`, `ui/src/lib/adapters/checkpointHostAdapter.ts`, `ui/src/lib/components/chat/AppChatPanel.svelte`, `ui/tests/utils/checkpointDelta.test.ts`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/chatui-checkpoints`.
- Automated test campaigns run on dedicated environments (`ENV=test-checkpoints`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/checkpoints/**`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/checkpoints.spec.ts`
  - `packages/chat-ui/tests/chat-conversation.spec.ts`
  - `ui/src/lib/adapters/checkpointHostAdapter.ts`
  - `ui/src/lib/components/chat/AppChatPanel.svelte`
  - `ui/tests/utils/checkpointDelta.test.ts`
  - `ui/src/lib/utils/checkpointDelta.ts` (DELETE only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - None declared.

## Feedback Loop
- none

## AI Flaky tests
- Acceptance rule: google-drive-picker flake is pre-existing non-systematic; accepted non-blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single lot, orthogonal to other branches)
- Rationale: Single-concern extraction; no multi-workstream dependencies.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on integrated branch after gates pass.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read plan `.tmp/lot2-checkpoints-plan.md` + source files.
  - [x] Confirm worktree `tmp/chatui-checkpoints` on branch `feat/chatui-checkpoints-module`.
  - [x] Confirm env `test-checkpoints`, ports API 9410, UI 5510, Maildev 1410.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Checkpoints module + adapter + AppChatPanel migration**
  - [x] Create `packages/chat-ui/src/checkpoints/classifier.ts` (pure TS, zero domain strings, generic git/bash/file_edit + isMutatingTool/isLocalToolName/humanizeMutation hooks).
  - [x] Create `packages/chat-ui/src/checkpoints/checkpointState.ts` (applySessionCheckpoints, getCheckpointForUserMessage, openCheckpointPrompt, PendingCheckpointPrompt).
  - [x] Create `packages/chat-ui/src/checkpoints/index.ts` (barrel + Checkpoint + CheckpointHost).
  - [x] Add `./checkpoints` subpath export to `packages/chat-ui/package.json`.
  - [x] Bump version 0.14.0 -> 0.15.0 in `packages/chat-ui/package.json`.
  - [x] Update `packages/chat-ui/export-manifest.json` `_version` + add `./checkpoints` entry.
  - [x] Update `packages/chat-ui/tests/chat-conversation.spec.ts` version assertions to 0.15.0.
  - [x] Create `ui/src/lib/adapters/checkpointHostAdapter.ts` (sentropic binding: API URLs, _create/_update/_delete suffixes, isLocalToolName, humanizeDomainMutationLabel).
  - [x] Delete `ui/src/lib/utils/checkpointDelta.ts` (no legacy fallback).
  - [x] Migrate `AppChatPanel.svelte`: import from module + adapter; delegate applySessionCheckpoints, getCheckpointForUserMessage, hasCheckpointRollbackDelta, getCheckpointPreviewTitle, loadCheckpoints, createTurnCheckpoint, applyCheckpointRestore to module/host.
  - [x] Update `ui/tests/utils/checkpointDelta.test.ts` to import from `@sentropic/chat-ui/checkpoints`.
  - [x] Create `packages/chat-ui/tests/checkpoints.spec.ts` (classifier, hook override, isLocalToolName default equivalence, checkpointState, fake-host harness, sentropic-string scan).
  - [x] Lot gate:
    - [ ] `make typecheck-chat-ui ENV=test-checkpoints` — GREEN
    - [ ] `make typecheck-ui UI_PORT=5510 ENV=test-checkpoints` — GREEN
    - [ ] `make test-chat-ui ENV=test-checkpoints` — GREEN (incl. checkpoints.spec.ts)
    - [ ] `make test-ui API_PORT=9410 UI_PORT=5510 MAILDEV_UI_PORT=1410 ENV=test-checkpoints` — GREEN (google-drive-picker flake OK)
    - [ ] sentropic-string scan on `src/checkpoints/` — EMPTY
