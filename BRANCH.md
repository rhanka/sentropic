# Feature: Wire StreamMessage into ChatConversation (live streaming)

## Objective
Wire the published `StreamMessage` component into `ChatConversation.svelte` so assistant/runtime segments render live streaming (markdown via svelte-streamdown) instead of the current `data-stream-id` placeholder. ADDITIVE: when `host.streamClient` is absent, existing placeholder/static rendering is preserved.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/components/ChatConversation.svelte`, `packages/chat-ui/package.json`, `packages/chat-ui/tests/chat-conversation.dom.spec.ts`, `packages/chat-ui/tests/chat-conversation.spec.ts`, `packages/chat-ui/export-manifest.json`, `Makefile` (BR-CONV-EX1 only), `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- No breaking API change to `ChatConversation` prop surface. Additive only.
- `StreamMessage.svelte` and `StreamMessage.svelte.d.ts` are FORBIDDEN (consume, do not modify).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/ChatConversation.svelte`
  - `packages/chat-ui/src/components/ChatConversation.svelte.d.ts` (only if props change — additive)
  - `packages/chat-ui/package.json` (version bump 0.8.0 → 0.9.0)
  - `packages/chat-ui/export-manifest.json` (only if prop snapshot changes)
  - `packages/chat-ui/tests/chat-conversation.dom.spec.ts`
  - `packages/chat-ui/tests/chat-conversation.spec.ts`
  - `Makefile` (BR-CONV-EX1: add svelte-streamdown to test-chat-ui-dom target only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/chat-ui/src/components/StreamMessage.svelte`
  - `packages/chat-ui/src/components/StreamMessage.svelte.d.ts`
  - `ui/src/**`
  - `.github/**`
  - other packages
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file) — not used in this branch
- **Exception process**:
  - BR-CONV-EX1: `Makefile` — add `svelte-streamdown` to `test-chat-ui-dom` target (see Feedback Loop).

## Feedback Loop
- BR-CONV-EX1 `attention`: Makefile `test-chat-ui-dom` does not include `svelte-streamdown`, which `StreamMessage.svelte` imports at the top level. Without it, the jsdom test that mounts `ChatConversation` with a `streamClient` (causing `StreamMessage` to import `svelte-streamdown`) will fail with a module-not-found error. Path: `Makefile` (conditional — normally forbidden). Rationale: `StreamMessage` is a peer-dep consumer of `svelte-streamdown`; the DOM test harness installs packages ephemerally in Docker; mirroring the existing pattern (e.g., `@lucide/svelte`) is the only way to make the jsdom test pass without touching `package.json` devDependencies. Impact: adds one npm package (`svelte-streamdown@3.x`) to the ephemeral Docker npm install in `test-chat-ui-dom`; no other target affected; no host package.json change. Rollback: remove `svelte-streamdown@3.0.1` from the npm install line and delete `packages/chat-ui/tests/chat-conversation.dom.spec.ts` streaming test block.
- Full local-tool async loop (parsePendingLocalToolCallsFromStatusPayload deep wiring) — deferred follow-up per original BRANCH spec.
- BR-38c attachments — flagged no-op; not in scope of this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: single package change, no sub-workstreams needed.

## UAT Management (in orchestration context)
- Mono-branch: UAT performed on integrated branch only. No service stack started (package-only, no Docker services).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, BRANCH_TEMPLATE, spec files.
  - [x] Verify worktree branch: `feat/chatui-conversation-stream-wiring`.
  - [x] Define scope boundaries and declare BR-CONV-EX1.

- [x] **Lot 1 — StreamMessage wiring + Makefile + tests + version bump**
  - [x] Wire `StreamMessage` import in `ChatConversation.svelte` for assistant/runtime segments when `host.streamClient` is present; keep placeholder when absent.
  - [x] Bump `packages/chat-ui/package.json` version 0.8.0 → 0.9.0.
  - [x] Update `packages/chat-ui/export-manifest.json` `_version` → 0.9.0 and `_propSnapshot` for ChatConversation.
  - [x] Update `packages/chat-ui/tests/chat-conversation.spec.ts` version pin 0.8.0 → 0.9.0.
  - [x] Extend `packages/chat-ui/tests/chat-conversation.dom.spec.ts` with streaming test (with streamClient) and no-streamClient fallback.
  - [x] Add `svelte-streamdown@3.0.1` to `Makefile` `test-chat-ui-dom` target (BR-CONV-EX1).
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui`
    - [x] `make build-chat-ui` + `make pack-chat-ui`
    - [x] `make test-chat-ui`
    - [x] `make test-chat-ui-dom`
