# Feature: chat-ui orphan sweep + comments composer fidelity (modularization Lot 6, final)

## Objective
Restore the comments composer EditableInput fidelity in AppChatPanel, sweep app-side orphans superseded by the chat-ui modules (composerBandItems, comment-adapter generic helpers), reclassify the new module subpaths in the reference-validation manifest, and bump @sentropic/chat-ui to 0.19.0.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`, `ui/src/lib/**`, `ui/tests/**`, `e2e/tests/04-tenancy-workspaces.spec.ts`.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/chatui-sweep` with `ENV=test-sweep`, ports API 9450 / UI 5550 / Maildev 1450.
- Automated test campaigns on `ENV=test-sweep` only, never on root `dev`.
- In every `make` command, `ENV=test-sweep` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/chat-ui-reference-validation.json`
  - `packages/chat-ui/src/comments/**`
  - `packages/chat-ui/tests/**`
  - `ui/src/lib/components/chat/AppChatPanel.svelte`
  - `ui/src/lib/chat/comment-adapter.ts`
  - `ui/src/lib/utils/documents.ts`
  - `ui/tests/**`
  - `e2e/tests/04-tenancy-workspaces.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Known local flake: `ui/tests` google-drive-picker.test.ts (2 fails, local-only).
  - Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: single final lot of the chat-ui modularization program, one worktree, one test cycle.

## UAT Management (in orchestration context)
- No UAT lot: zero intended UX change (fidelity restore proven by e2e 04 contenteditable selector).

## Plan / Todo (lot-based)
- [x] **Lot 1 — Comments composer fidelity restore**
  - [x] AppChatPanel.svelte renderComposerInput snippet mounting EditableInput (contenteditable) in the comments composer (keydown forwarding + on:change value sync).
  - [x] e2e/tests/04-tenancy-workspaces.spec.ts selector reverted to `[contenteditable="true"]` (fidelity oracle).
  - [x] Lot gate: covered by Lot 4 full gates.

- [x] **Lot 2 — Orphan sweep (app side)**
  - [x] ui/src/lib/utils/documents.ts: delete dead `composerBandItems` + `ComposerAttachmentLike` + `UnifiedAttachmentKind` + `UnifiedAttachmentItem` + `isImageMimeType` (canonical home: `@sentropic/chat-ui/documents` `buildAttachmentBandItems`); zero callers proven by grep.
  - [x] ui/tests/utils/documents.test.ts: drop composerBandItems + isImageMimeType blocks.
  - [x] ui/src/lib/chat/comment-adapter.ts: delete generic helpers + *Like types duplicated by `@sentropic/chat-ui/comments`; keep only SECTION_LABEL_KEYS + getCommentSectionLabel (sentropic binding).
  - [x] ui/tests/chat/comment-adapter.test.ts: re-point generic helper imports to `@sentropic/chat-ui/comments`.
  - [x] packages/chat-ui/src/comments/utils.ts + types.ts: remove stale doc references to the deleted app-side copies.

- [x] **Lot 3 — Reference-validation reclassify + 0.19.0 bump**
  - [x] chat-ui-reference-validation.json: add headless entries (checkpoints/context/documents/comments), primitive entries (AttachmentBand/GeneratedFileCardTray/CommentsPanel dogfooded by AppChatPanel), non-canonical gated entries (CommentTimeline/CommentComposer/CommentThreadNav); ContextChips/SessionList legacy entries kept.
  - [x] tests/reference-validation.spec.ts: extend extraction to all `./<dir>/*.svelte` exports + module index subpaths + duplicate-basename guard.
  - [x] packages/chat-ui/package.json bumped 0.19.0; export-manifest.json _version/_generated bumped.
  - [x] Version assertions updated: chat-conversation.spec.ts, chat-core-host.spec.ts, documents-module.spec.ts (no other 0.18.0 left in packages/chat-ui/tests + ui/tests).

- [x] **Lot 4 — Final gates**
  - [x] `make typecheck-chat-ui` + `make typecheck-ui` (REGISTRY=local, ports 9450/5550/1450, ENV=test-sweep): 0 errors.
  - [x] `make test-chat-ui`: 39 files / 759 tests PASS.
  - [x] `make test-ui` full: 73/74 files, 440/442 tests PASS — only known local flake google-drive-picker.test.ts (2 fails).
  - [x] String scan: zero sentropic-specific strings in packages/chat-ui/src (doc comments + wire-contract names justified).
  - [x] E2E: `make build-api` + `make build-ui-image` then `make test-e2e E2E_SPEC=tests/04-tenancy-workspaces.spec.ts` 6/6 PASS (comments composer via contenteditable selector).
  - [x] `make down` after e2e to free ports.
