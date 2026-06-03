# Feature: ChatConversation turnkey assembly for @sentropic/chat-ui

## Objective
Add `ChatConversation.svelte` — a turnkey, app-agnostic 1:1 chat dialogue to `@sentropic/chat-ui` (0.5.0 → 0.6.0). Composes the already-published primitives (ChatTimeline, StreamMessage, ChatComposer, ModelSelector, MessageActions, ContextChips) into a parameterized dialogue with feature-flagged optional concerns.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/components/ChatConversation.svelte` (+ `.svelte.d.ts`), `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, and `packages/chat-ui/tests/chat-conversation.{spec,dom.spec}.ts`.
- ADDITIVE export only — no existing exports renamed or removed.
- No app changes (`ui/src/**` forbidden), no Makefile changes, no other packages.
- NO lift of `AppChatPanel.svelte` — this is a pure composition of published primitives.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/feat-chatui-conversation-turnkey`.
- All code/comments/docs in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/ChatConversation.svelte`
  - `packages/chat-ui/src/components/ChatConversation.svelte.d.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/chat-conversation.spec.ts`
  - `packages/chat-ui/tests/chat-conversation.dom.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `ui/src/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - All other packages
  - Any existing export in `packages/chat-ui/src/components/**` (rename/remove)
- **Conditional Paths (allowed only with explicit exception)**:
  - None declared

## Feedback Loop
- `deferred` — Full local-tool async wiring (execute+permission+stop loop) deferred to follow-up. Component has feature flag surface and type-safe prop API; wiring scaffolded but async execution not connected at runtime. Records in Lot 1 output.
- `deferred` — BR-38c attachment tray defaults are not yet in `@sentropic/chat-ui`; `features.attachments` flag is present in the API but renders nothing until BR-38c lands.
- `deferred` — `features.comments`, `features.documents`, `features.jobs`, `features.workspaceScope` flags are present but adapters are typed only; no UI mount (app-owned, stays behind flags).

## AI Flaky tests
- None in scope (no AI calls; all tests are pure unit/DOM).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (additive lib-only change; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single package, additive export, no orchestration needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch (post-merge); no separate UAT lot required — this is a lib-only additive export with no app UI surface changed.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, spec, primitives sources.
  - [x] Confirm branch is `feat/chatui-conversation-turnkey`.
  - [x] Confirm allowed paths and guardrails.
  - [x] Spec §5 prop API confirmed as contract.

- [x] **Lot 1 — ChatConversation component + export + tests**
  - [x] Write `packages/chat-ui/src/components/ChatConversation.svelte`.
  - [x] Write `packages/chat-ui/src/components/ChatConversation.svelte.d.ts`.
  - [x] Bump `packages/chat-ui/package.json` version 0.5.0 → 0.6.0; ADD export subpath.
  - [x] ADD subpath to `packages/chat-ui/export-manifest.json`.
  - [x] Write node test `packages/chat-ui/tests/chat-conversation.spec.ts`.
  - [x] Write DOM test `packages/chat-ui/tests/chat-conversation.dom.spec.ts`.
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui`
    - [x] `make build-chat-ui` && `make pack-chat-ui`
    - [x] `make test-chat-ui`
    - [x] `make test-chat-ui-dom`

- [x] **Lot N — Final validation + PR**
  - [x] All 4 gate commands green.
  - [x] `make commit` with selective staging.
  - [x] `git push origin feat/chatui-conversation-turnkey`.
  - [x] `gh pr create` (base `main`, BRANCH.md as body). NOT merged.
