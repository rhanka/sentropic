# Feature: chat-ui modularization — ChatCoreHost contract (Lot 1 Step 1)

## Objective
Ratify the `ChatCoreHost` typed contract (transport + streaming + local-tool + steer) derived from real call-sites. Prove sentropic host conforms via `satisfies ChatCoreHost`. Zero behavior change.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`, `ui/src/lib/chat/**`, `BRANCH.md`.
- No orchestration code moved; contract-only, no behavior change.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chatui-core-panel`.
- Test ENV: `ENV=test-corepanel` (NEVER `ENV=dev`).
- In every `make` command, `ENV=test-corepanel` must be passed as the last argument.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/**`
  - `ui/src/lib/chat/**`
  - `ui/src/lib/components/chat/**` (read-only reconnaissance; no writes in Lot 1 Step 1)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** (single branch, contract-only step)
- Rationale: Step 1 is a pure type contract with no orchestration impact.

## Plan / Todo (lot-based)

- [x] **Lot 1 — ChatCoreHost contract ratification (Step 1)**
  - [x] Study real call-sites: `transport.ts`, `streamHub.ts`, `streamTypes.ts`, `replay.ts`, `web-host-adapter.ts`, `session-adapter.ts`, `AppChatPanel.svelte` (sendMessage ~L4237, retryMessage ~L2992, stopAssistantMessage ~L4387, saveEditMessage ~L2912, setFeedback ~L4401, deleteCurrentSession ~L4052, pollJobUntilTerminal ~L4089, postLocalToolResultWithRetry ~L796, loadModelCatalog ~L4140, sendComposerSteer→postChatSteer ~L3338)
  - [x] Create `packages/chat-ui/src/client/chat-core-host.ts` exporting `ChatCoreHost` + `SessionSummary`, `SendMessagePayload`, `RunHandle`, `ModelCatalog`. Includes transport REST verbs, StreamHub client surface, `postLocalToolResult`, `postSteer`. Zero sentropic domain strings.
  - [x] Prove conformance: `ui/src/lib/chat/chat-core-host-adapter.ts` with `satisfies ChatCoreHost` assertion on `createSentropicChatCoreHost`. Zero runtime change.
  - [x] Add `packages/chat-ui/tests/chat-core-host.spec.ts`: fake host `satisfies ChatCoreHost` (compile proof) + runtime assertions + export-surface check + sentropic-string scan.
  - [x] Export: add `./client/chat-core-host` to `packages/chat-ui/package.json` exports + update `export-manifest.json`.
  - [x] Version: bump `packages/chat-ui/package.json` 0.13.1 → 0.14.0. Update version assertions in `chat-conversation.spec.ts`.
  - [x] Lot gate:
    - [x] `make typecheck-ui API_PORT=9400 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=test-corepanel` → 0 errors
    - [x] `make typecheck-chat-ui ENV=test-corepanel` → exit 0
    - [x] `make test-chat-ui ENV=test-corepanel` → 456/456 pass

## Feedback Loop
- None.

## AI Flaky tests
- None applicable in this step (no AI calls).
