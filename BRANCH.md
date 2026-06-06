# Feature: chat-ui modularization — ChatCoreHost contract (Lot 1 Steps 1+2)

## Objective
Ratify the `ChatCoreHost` typed contract (transport + streaming + local-tool + steer) derived from real call-sites. Genericize StreamHub event taxonomy (no domain strings in type exports). Make AppChatPanel consume host transport verbs. Prove sentropic host conforms via `satisfies ChatCoreHost`. Zero behavior change.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`, `ui/src/lib/chat/**`, `ui/src/lib/components/chat/**`, `BRANCH.md`.
- Zero behavior change: refactor call-sites only, no logic/DOM/state/scroll changes.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chatui-core-panel`.
- Test ENV: `ENV=test-corepanel` (NEVER `ENV=dev`).
- In every `make` command, `ENV=test-corepanel` must be passed as the last argument.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/**`
  - `ui/src/lib/chat/**`
  - `ui/src/lib/components/chat/**`
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
- Rationale: Steps are pure type contract + refactor with no orchestration impact.

## Plan / Todo (lot-based)

- [x] **Lot 1 Step 1 — ChatCoreHost contract ratification**
  - [x] Study real call-sites: `transport.ts`, `streamHub.ts`, `streamTypes.ts`, `replay.ts`, `web-host-adapter.ts`, `session-adapter.ts`, `AppChatPanel.svelte` (sendMessage ~L4237, retryMessage ~L2992, stopAssistantMessage ~L4387, saveEditMessage ~L2912, setFeedback ~L4401, deleteCurrentSession ~L4052, pollJobUntilTerminal ~L4089, postLocalToolResultWithRetry ~L796, loadModelCatalog ~L4140, sendComposerSteer→postChatSteer ~L3338)
  - [x] Create `packages/chat-ui/src/client/chat-core-host.ts` exporting `ChatCoreHost` + `SessionSummary`, `SendMessagePayload`, `RunHandle`, `ModelCatalog`. Includes transport REST verbs, StreamHub client surface, `postLocalToolResult`, `postSteer`. Zero sentropic domain strings.
  - [x] Prove conformance: `ui/src/lib/chat/chat-core-host-adapter.ts` with `satisfies ChatCoreHost` assertion on `createSentropicChatCoreHost`. Zero runtime change.
  - [x] Add `packages/chat-ui/tests/chat-core-host.spec.ts`: fake host `satisfies ChatCoreHost` (compile proof) + runtime assertions + export-surface check + sentropic-string scan.
  - [x] Export: add `./client/chat-core-host` to `packages/chat-ui/package.json` exports + update `export-manifest.json`.
  - [x] Version: bump `packages/chat-ui/package.json` 0.13.1 → 0.14.0.
  - [x] Lot gate: `make typecheck-ui`, `make typecheck-chat-ui`, `make test-chat-ui` → 426/426 pass

- [x] **Lot 1 Slice 1A.0 — Genericize StreamHub event taxonomy (non-breaking)**
  - [x] Remove sentropic domain event literals from `STREAM_HUB_EVENT_TYPES` and `StreamHubEvent` union in `streamTypes.ts`
  - [x] Add `export type StreamHubEventType = (typeof STREAM_HUB_EVENT_TYPES)[number] | (string & {})`
  - [x] Widen `onlyType` from `'job_update' | 'organization_update'` to `StreamHubEventType`
  - [x] Add `onlyTypes?: StreamHubEventType[]` to `StreamHubSubscription`
  - [x] Fix `streamHub.ts`: add `ALL_SSE_EVENT_TYPES` const (private, includes domain strings) for SSE listener registration; cast domain event dispatch objects as `StreamHubEvent`
  - [x] Fix `streamHistory.ts`: use `asRecord(event)` for domain event field access (no union narrowing needed)
  - [x] Gate: `make typecheck-chat-ui` → exit 0; `make test-chat-ui` → 426/426 pass

- [ ] **Lot 1 Slice 1A — Real transport verbs on host; AppChatPanel consumes them (ZERO-DOM)**
  - [ ] Extend `ChatCoreTransport` in `packages/chat-ui/src/client/transport.ts` with all host verbs
  - [ ] Create `ChatCoreTransportFactory` web impl via `createDefaultChatCoreTransport`
  - [ ] Refactor AppChatPanel to use host/transport verbs for all ChatCoreHost call-sites
  - [ ] Gate: `make typecheck-ui`, `make typecheck-chat-ui`, `make test-chat-ui`, `make test-ui` → all green

## Feedback Loop
- None.

## AI Flaky tests
- None applicable in this step (no AI calls).
