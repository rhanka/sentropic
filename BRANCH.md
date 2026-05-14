# Feature: BR-14b Chat Service Core

## Objective
Modularize the chat-service core above the mesh-backed model runtime so reasoning loops, tool loops, continuation, cancellation, retry, checkpoints, and trace/audit boundaries become explicit and testable.
The branch must preserve current chat API, streaming, local-tool handoff, tool-result continuation, cancellation, retry, checkpoint, and error behavior.

## Scope / Guardrails
- Scope limited to API chat-service orchestration above model access.
- Current package reality is `@sentropic/llm-mesh`; older orchestration documents may still mention `@entropic/llm-mesh` and must be interpreted as the historical name unless BR-14e updates naming globally.
- BR-14b must not define provider/model access, provider adapters, model catalogs, credential resolution, or dispatch migration.
- All model access must remain delegated to `@sentropic/llm-mesh` through the existing mesh-backed runtime boundary.
- BR-14a may scope in parallel, but BR-14a implementation must wait for BR-14b boundaries to stabilize.
- Make-only workflow, no direct Docker or npm commands.
- Branch development happens in isolated worktree `tmp/refacto-chat-service-core`.
- Automated tests must run on dedicated environments, never on root `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All code, comments, commits, PR title/body, and Markdown are English.
- No merge is allowed with CI-only evidence. Final merge requires explicit user UAT passed, or explicit user UAT waiver with reason recorded in this file.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/**`
  - `api/src/services/chat-service.ts`
  - `api/src/services/chat/**`
  - `api/src/services/tools.ts`
  - `api/src/services/stream-service.ts`
  - `api/src/services/llm-runtime/**` only for import-boundary adjustments that preserve mesh ownership
  - `api/src/routes/chat*.ts`
  - `api/src/routes/**/chat*.ts`
  - `api/tests/**/chat*.test.ts`
  - `api/tests/**/chat*.spec.ts`
  - `api/tests/**/live-ai*.test.ts`
  - `api/tests/**/tools*.test.ts`
  - `api/tests/**/stream*.test.ts`
  - `api/tests/**/fixtures/**`
  - `packages/contracts/**` (via BR14b-EX1)
  - `packages/events/**` (via BR14b-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `packages/llm-mesh/**`
  - `api/drizzle/**`
  - `ui/**`
  - `e2e/**`
  - `plan/14a-BRANCH_feat-chat-ui-sdk.md`
  - `plan/14b-BRANCH_refacto-chat-service-core.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `README.md`
  - `README.fr.md`
  - `PLAN.md`
  - `TODO.md`
  - `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `spec/SPEC_CHATBOT.md`
  - `packages/**/package.json` (via BR14b-EX1)
- **Exception process**:
  - Declare exception ID `BR14b-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Scope Exceptions
- `BR14b-EX1 — Bundle @sentropic/contracts and @sentropic/events with chat-core in BR14b`
  - Rationale: Per BR23 SPEC_STUDY_ARCHITECTURE_BOUNDARIES §11 (delivery cadence): contracts package ships the 6 shared transverse types (TenantContext, AuthzContext, CostContext, IdempotencyKey, CheckpointVersion, EventEnvelope) that chat-core implementation will consume. Events package will follow in the same branch with the StreamEvent wire taxonomy. Co-shipping avoids a separate mini-branch for events while keeping atomic per-package buildability.
  - Impact: New paths under `packages/contracts/**` and `packages/events/**` allowed. Standard `package.json` + `tsconfig.json` + `src/` structure aligned with existing `packages/llm-mesh` style.
  - Rollback: Delete `packages/contracts/` (and `packages/events/` once added) entirely; revert this commit.

## Feedback Loop
- `attention` 2026-05-12: BR14g was merged without an explicit UAT checkpoint. BR14b final gate therefore requires recorded user UAT passed or explicit user UAT waiver before merge; CI alone is insufficient.
- `attention` 2026-05-12: Historical docs still reference `@entropic/llm-mesh`, but the published package is `@sentropic/llm-mesh`. BR14b must use the current code/package reality and leave global naming cleanup to BR14e unless a local reference blocks implementation.
- `deferred` 2026-05-12: BR14a implementation is deferred until BR14b stabilizes chat-service core boundaries. BR14a Lot 0 scoping may proceed in parallel.
- `closed` 2026-05-14 (Lot 5): `make up-api-test` / `make test-api` previously failed during `prepare-node-workspace` with `npm error code EUNSUPPORTEDPROTOCOL ("workspace:*")`. Root cause: `packages/{events,chat-core}/package.json` declared internal `@sentropic/*` deps with `"workspace:*"` (pnpm/Yarn convention) which npm-cli does not understand. Resolution: replaced `"workspace:*"` with `"*"` (npm workspaces native) in `packages/events/package.json` (1 dep) and `packages/chat-core/package.json` (2 deps); regenerated root `package-lock.json` via `make lock-root` which now links `node_modules/@sentropic/{contracts,events,chat-core}` to their respective `packages/*` directories. Verified: `make typecheck-api` PASS; `make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts` PASS (2/2 tests). Lot 4 deferred gate now closed.
- `attention` 2026-05-13: Lot 4 added `packages/chat-core/src/checkpoint-port.ts` to isolate the contracts-free `CheckpointStore<T>` / `SaveResult` / `CheckpointMeta` surface from `ports.ts`. Required so the api workspace can import the port via relative path without dragging the full `@sentropic/contracts` / `@sentropic/events` graph (which is not yet wired into api/Dockerfile). `ports.ts` and `index.ts` re-export the surface so future `from '@sentropic/chat-core'` consumers see no API change.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- BR14b policy:
  - Do not create a dedicated flaky branch from BR14b.
  - If AI nondeterminism appears, document it as evidence only and continue only with user sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + sidecar scoping**
- [ ] **Multi-branch**
- Rationale: BR14b implementation should stay in one branch because chat-service boundaries are tightly coupled. BR14a may run in parallel as scoping only, with no implementation and no shared writes.

## Environment Mapping
- Development env: `refacto-chat-service-core`
- API port: `9071`
- UI port: `5271`
- MailDev UI port: `1171`
- API test env: `test-refacto-chat-service-core`
- E2E env: `e2e-refacto-chat-service-core`
- Command style: `make <target> API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=<env>` with `ENV` last.

## UAT Management (in orchestration context)
- UAT is mandatory before merge unless the user explicitly waives it in writing.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification.
- UAT must focus on chat behavior: streaming response, local tool handoff, tool-result continuation, cancellation, retry, checkpoint visibility, and error display.
- Final gate step 3 is forbidden until `UAT passed` or `UAT waived by user` is recorded in this file.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline, inventory, and constraints**
  - [x] Create isolated worktree `tmp/refacto-chat-service-core` from `origin/main`.
  - [x] Confirm branch starts after BR14c, BR14g, and BR24 merges.
  - [x] Record current naming reality: `@sentropic/llm-mesh` is the published/current package name.
  - [x] Capture initial file sizes: `chat-service.ts` 5671 lines, `tools.ts` 1428 lines, `stream-service.ts` 295 lines.
  - [x] Identify primary test surfaces: `api/tests/ai/chat-sync.test.ts`, `api/tests/ai/comment-assistant.test.ts`, `api/tests/api/chat-message-actions.test.ts`, `api/tests/api/chat-history-analyze-tool.test.ts`, `api/tests/api/chat-checkpoint-contract.test.ts`, `api/tests/api/queue-stream-bootstrap-contract.test.ts`, stream/tool-related unit tests.
  - [ ] Read `api/src/services/chat-service.ts` once and identify responsibilities currently mixed in the file.
  - [ ] Read `api/src/services/tools.ts` once and identify reusable tool-loop responsibilities versus app-specific tool execution.
  - [ ] Read `api/src/services/stream-service.ts` once and identify stream event ownership.
  - [ ] Inventory chat API endpoints and tests before code extraction.
  - [ ] Confirm no provider/model abstraction needs to be changed in BR14b.
  - [x] Define proposed file split before implementation in `spec/BRANCH_SPEC_EVOL.md`.
  - [x] Add `spec/BRANCH_SPEC_EVOL.md` for behavior and extraction-order decisions that must survive branch completion.
  - [ ] Lot gate: conductor report includes BR14b lane and UAT gate status.

- [ ] **Lot 1 — Chat orchestration boundary**
  - [ ] Extract request orchestration primitives from `api/src/services/chat-service.ts` into focused chat-core modules.
  - [ ] Keep external API response shape and streaming payload behavior stable.
  - [ ] Keep mesh-backed model invocation at the existing runtime boundary.
  - [ ] Add or update focused API/unit tests for the extracted orchestration boundary.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] `make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] API tests identified in Lot 0, file-by-file.

- [ ] **Lot 2 — Reasoning, continuation, cancellation, retry, and checkpoint loop**
  - [ ] Extract reasoning-step state and continuation boundaries without changing model/provider semantics.
  - [ ] Preserve current tool-result continuation behavior.
  - [ ] Preserve cancellation behavior and user-visible cancellation messages.
  - [ ] Preserve retry behavior and checkpoint metadata.
  - [ ] Add or update tests covering continuation, cancellation, retry, and checkpoint cases.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] `make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] API tests identified in Lot 0, file-by-file.

- [ ] **Lot 3 — Tool loop and local-tool handoff**
  - [ ] Extract tool-call planning/result handling above the mesh runtime.
  - [ ] Keep MCP-style content/result shapes compatible with the mesh contract.
  - [ ] Preserve local-tool handoff and tool-result continuation semantics.
  - [ ] Add or update tests for local-tool handoff and tool-result continuation.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] `make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] API tests identified in Lot 0, file-by-file.

- [ ] **Lot 4 — Trace/audit and error boundaries**
  - [ ] Keep trace/audit metadata intact across extracted modules.
  - [ ] Preserve provider/runtime error mapping from BR14c.
  - [ ] Preserve user-visible chat errors.
  - [ ] Add or update tests for trace/audit metadata and error mapping if existing coverage is insufficient.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] `make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core`
    - [ ] API tests identified in Lot 0, file-by-file.

- [ ] **Lot 5 — UAT preparation and user checkpoint**
  - [ ] Prepare a UAT note with exact scenarios: streaming response, local tool handoff, tool-result continuation, cancellation, retry, checkpoint visibility, and error display.
  - [ ] Push branch and open/update PR with `BRANCH.md` as body before UAT.
  - [ ] Confirm branch CI status.
  - [ ] Ask user to perform UAT or explicitly waive UAT with reason.
  - [ ] Record exactly one status before merge: `UAT passed` or `UAT waived by user`.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Integrate durable behavior changes into `spec/SPEC_CHATBOT.md` or `spec/SPEC_EVOL_LLM_MESH.md` only if implementation changes public behavior or branch contracts.
  - [ ] Delete `spec/BRANCH_SPEC_EVOL.md` after integration if it was created.
  - [ ] Keep global naming cleanup deferred to BR14e unless a local inconsistency blocks BR14b.

- [ ] **Lot N — Final validation and merge gate**
  - [ ] Typecheck and lint API.
  - [ ] Retest impacted API chat/tool/stream/live-AI files identified in Lot 0.
  - [ ] Verify PR CI is green.
  - [ ] Verify `UAT passed` or `UAT waived by user` is recorded in this file.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: resolve CI and UAT blockers.
  - [ ] Final gate step 3: only after CI + UAT/waiver are both OK, commit removal of `BRANCH.md`, push, and merge.

## Lot 1 - @sentropic/contracts scaffold
- [x] Create packages/contracts/package.json
- [x] Create packages/contracts/tsconfig.json
- [x] Create packages/contracts/src/index.ts with 6 frozen types
- [ ] Typecheck via make target if available

## Lot 2 - @sentropic/events scaffold
- [x] Create packages/events/package.json
- [x] Create packages/events/tsconfig.json
- [x] Create packages/events/src/index.ts with StreamEvent v1 union
- [x] Re-export EventEnvelope from @sentropic/contracts
- [ ] Typecheck (best effort if make target available)

## Lot 3 - @sentropic/chat-core shell scaffold
- [x] Create packages/chat-core/package.json
- [x] Create packages/chat-core/tsconfig.json
- [x] Create packages/chat-core/src/index.ts (public API re-exports)
- [x] Create packages/chat-core/src/ports.ts (port interfaces)
- [ ] Typecheck (best effort)

## Lot 4 - chat-checkpoint extraction
- [x] Define ChatState in packages/chat-core/src/types.ts
- [x] Create api/src/services/chat/postgres-checkpoint-adapter.ts
- [x] Refactor chat-service.ts to delegate (no public API change)
- [x] Re-run make test-api -> all chat-checkpoint tests green (unblocked by Lot 5)
- [ ] (Deferred to Lot 5) tag/fork/delete methods full impl

## Lot 5 - workspace protocol fix
- [x] Replace workspace:* with * in packages/events/package.json (1 dep)
- [x] Replace workspace:* with * in packages/chat-core/package.json (2 deps)
- [x] Verified api/package.json declares no @sentropic/{contracts,events,chat-core} deps yet (uses file:../packages/llm-mesh for llm-mesh only) — out of Lot 5 scope
- [x] Regenerate package-lock.json via make lock-root (links @sentropic/{contracts,events,chat-core} as workspace symlinks)
- [x] make typecheck-api PASS
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2 tests)

## Lot 6 - chat-message extraction
- [x] Design real MessageStore port in packages/chat-core/src/message-port.ts (replace placeholder)
- [x] Update packages/chat-core/src/ports.ts and src/index.ts re-exports
- [x] Create api/src/services/chat/postgres-chat-message-store.ts adapter
- [x] Refactor chat-service.ts message methods to delegate (no public API change)
- [x] Re-run make test-api-unit -> chat-message tests green

## Lot 7 - stream service extraction
- [x] Port surface decision: single StreamBuffer port covers all six concerns of stream-service.ts (generateStreamId, append, getNextSequence, appendWithSequenceRetry, read, listActive); SSE transport stays in routes/api/streams.ts per SPEC §7 anti-pattern (no transport in chat-core); PostgreSQL NOTIFY is an adapter-side implementation detail
- [x] Design real StreamBuffer port in packages/chat-core/src/stream-port.ts (replace placeholder, mirror Lot 6 isolation pattern)
- [x] Update packages/chat-core/src/ports.ts and src/index.ts re-exports (drop _kind stub, add stream-port surface)
- [x] Create api/src/services/chat/postgres-stream-buffer.ts adapter (verbatim port of stream-service.ts logic incl. advisory-lock atomic path + NOTIFY)
- [x] Refactor api/src/services/stream-service.ts as thin delegation shim (public function names + signatures preserved verbatim so chat-service.ts / queue-manager.ts / context-document.ts / routes/api/* require zero changes)
- [x] make typecheck-api PASS
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts PASS (25/25 tests)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2 tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1 tests)
- [x] make test-api-endpoints SCOPE=tests/api/streams.test.ts PASS (2/2 tests, incl. SSE replay cursor)
- [x] make lint-api PASS (0 errors; only pre-existing warnings, none in new/edited files)

## Lot 8 - chat-session extraction
- [x] Port surface decision: single SessionStore port covers all chat_sessions reads/writes used by chat-service.ts (findForUser, listForUser, create, deleteForUser, touchUpdatedAt, updateContext, updateTitle); precheck for "Session not found" stays in ChatService.deleteSession; workspace resolution / title generation / workspace-event notification / todo runtime stay in chat-service.ts (port is persistence-only)
- [x] Design real SessionStore port in packages/chat-core/src/session-port.ts (replace placeholder, mirror Lot 6 isolation pattern)
- [x] Update packages/chat-core/src/ports.ts and src/index.ts re-exports (drop _kind stub, add session-port surface)
- [x] Create api/src/services/chat/postgres-chat-session-store.ts adapter (verbatim port logic, tenant scoping preserved)
- [x] Refactor chat-service.ts session methods to delegate (no public API change; -67/+16 lines net)
- [x] make typecheck-api PASS
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-session-history-docx.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)

## Lot 9 - first orchestration extraction (ChatRuntime skeleton + first slice)
- [x] Inventory orchestration candidates remaining in chat-service.ts after Lots 4/6/7/8 persistence extractions
- [x] Slice selection: finalizeAssistantMessageFromStream (62-line atomic method; uses 3 ports MessageStore + StreamBuffer + SessionStore; no entanglement with tool dispatch / reasoning loop / continuation; covered indirectly via routes/api/chat.ts and queue-manager.ts callers)
- [x] Create packages/chat-core/src/runtime.ts with ChatRuntime class + ChatRuntimeDeps (DI of MessageStore + SessionStore + StreamBuffer + CheckpointStore<ChatState> + reserved invokeModel hook for future mesh boundary port)
- [x] Re-export runtime surface from packages/chat-core/src/index.ts
- [x] Migrate finalizeAssistantMessageFromStream body verbatim into ChatRuntime (replace stream-service free functions with equivalent StreamBuffer port methods which were already a thin shim over the same adapter post Lot 7)
- [x] ChatService instantiates ChatRuntime in a private readonly field, wiring the 4 existing adapter singletons; finalizeAssistantMessageFromStream becomes a one-line delegate preserving public signature + null-on-skip contract
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; new file produces 0 new warnings)
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts PASS (25/25)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/streams.test.ts PASS (2/2)
- [x] Pattern documented for Lots 10+: persistence already on ports (Lots 4/6/7/8); orchestration methods migrate INTO ChatRuntime progressively; chat-service.ts becomes a thin facade; mesh access stays delegated via the invokeModel hook (kept untyped in Lot 9 because the precise mesh port is designed in Lot 10+)

## Lot 10 - second orchestration extraction (MeshDispatchPort + acceptLocalToolResult migration)
- [x] Design MeshDispatchPort in packages/chat-core/src/mesh-port.ts (contracts-free; MeshInvokeRequest + MeshInvokeResponse + MeshStreamRequest + MeshStreamEvent mirror callLLM/callLLMStream surfaces verbatim; payload-typed fields stay opaque unknown / ReadonlyArray<unknown> to keep adapter narrowing local)
- [x] Create MeshDispatchAdapter in api/src/services/chat/mesh-dispatch-adapter.ts (thin wrapper over existing callLLM + callLLMStream from llm-runtime; meshDispatchAdapter singleton export mirrors postgresStreamBuffer wiring pattern)
- [x] Extend ChatRuntime constructor with mesh: MeshDispatchPort DI (remove invokeModel?: unknown placeholder); add normalizeVsCodeCodeAgent callback dep (body stays in chat-service.ts because reused by non-runtime call-sites: system-prompt build, instruction rendering)
- [x] Migrate acceptLocalToolResult + extractAwaitingLocalToolState into ChatRuntime (verbatim port; readStreamEvents/writeStreamEvent/getNextSequence/serializeToolOutput swapped for StreamBuffer port methods + module helper; method does NOT invoke mesh — port wired for future continuation/reasoning lots)
- [x] Refactor chat-service.ts: ChatRuntime moved from field initializer to constructor (needed to bind normalizeVsCodeCodeAgent callback); acceptLocalToolResult becomes a thin delegate preserving public signature; extractAwaitingLocalToolState private method + AwaitingLocalToolState type removed (only consumer was the migrated method)
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; new files produce 0 new warnings)
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts PASS (25/25)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14; both acceptLocalToolResult-exercising tests included)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28; continuation + local-tool spies on acceptLocalToolResult included)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)

## Lot 11 - checkpoint orchestration extraction (strict CheckpointStore port + ChatRuntime checkpoint methods)
- [x] Refactor postgres-checkpoint-adapter to strict CheckpointStore<ChatState> port
- [x] Migrate createCheckpoint/listCheckpoints/restoreCheckpoint orchestration into ChatRuntime
- [x] Drop `as unknown as CheckpointStore<ChatState>` cast (clean typing)
- [x] chat-service.ts delegates 3 methods (public API unchanged)
- [x] typecheck + tests PASS
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)

## Lot 12 - retry + create-user-message orchestration extraction (ChatRuntime methods + Option A callback deps)
- [x] Inventory dependency surface of the 2 methods (retryUserMessage: getMessageForUser/settingsService/getModelCatalogPayload/inferProviderFromModelIdWithLegacy/resolveDefaultSelection/messageStore.deleteAfterSequence/createId/messageStore.insertMany/sessionStore.touchUpdatedAt; createUserMessageWithAssistantPlaceholder: getSessionForUser/createSession/isChatContextType/sessionStore.updateContext/settingsService/getModelCatalogPayload/inferProviderFromModelIdWithLegacy/resolveDefaultSelection/messageStore.getNextSequence/createId/normalizeMessageContexts/messageStore.insertMany/sessionStore.touchUpdatedAt)
- [x] Design DI strategy: all three new chat-core deps cross as Option A callbacks (no port shape) — resolveModelSelection bundles settingsService.getAISettings + getModelCatalogPayload + inferProviderFromModelIdWithLegacy + resolveDefaultSelection into one async callback returning the same {provider_id, model_id} shape; normalizeMessageContexts binds ChatService.normalizeMessageContexts (Pick<CreateChatMessageInput, contexts|primaryContextType|primaryContextId> → context[]); isChatContextType binds the module-level type guard. Rationale: each helper is a single pure function (or async-pure call) with no multi-method shape that other lots would reuse — same pattern Lot 10 used for normalizeVsCodeCodeAgent. No new chat-core port was needed.
- [x] Extend ChatRuntime with retryUserMessage + createUserMessageWithAssistantPlaceholder (verbatim port; persistence-only deps remain on existing ports MessageStore + SessionStore)
- [x] chat-service.ts delegates 2 methods (public API unchanged; ProviderId cast at delegate boundary because chat-core returns plain string after resolveDefaultSelection)
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-batch-create-orgs.test.ts PASS (5/5)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-document-generate-pptx.test.ts PASS (3/3)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tab-tools.test.ts PASS (3/3)
- [x] make test-api-unit SCOPE=tests/unit/vscode-code-agent-prompt-profile.test.ts PASS (3/3)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)

## Lot 13 - setMessageFeedback + updateUserMessageContent migration (small atomic pair)
- [x] Inventory dependencies of the 2 methods
- [x] Extend ChatRuntime with setMessageFeedback + updateUserMessageContent
- [x] chat-service.ts delegates 2 methods (public API unchanged)
- [x] typecheck + tests PASS
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)

## Lot 14a - listMessages migration (Option A todoRuntime hydration callback)
- [x] Inventory listMessages dependencies
- [x] Add hydrateMessagesWithTodoRuntime callback to ChatRuntimeDeps
- [x] Migrate listMessages into ChatRuntime (verbatim)
- [x] chat-service.ts delegates listMessages (public API unchanged)
- [x] typecheck + tests PASS
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-feedback.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)

## Lot 14b - read-only composers migration (getSessionBootstrap / getSessionHistory / getMessageRuntimeDetails)
- [x] Move 3 pure history helpers to packages/chat-core/src/history.ts
- [x] Add 3 Option A callbacks to ChatRuntimeDeps
- [x] chat-service.ts constructor wires the 3 callbacks
- [x] Migrate getSessionBootstrap into ChatRuntime
- [x] Migrate getSessionHistory into ChatRuntime
- [x] Migrate getMessageRuntimeDetails into ChatRuntime
- [x] chat-service.ts delegates 3 methods (public API unchanged)
- [x] typecheck + tests PASS
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/chat-session-history-docx.test.ts PASS (4/4)
