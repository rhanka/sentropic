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
  - `packages/chat-core/tests/**` (via BR14b-EX3)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (except `test-pkg-chat-core` target addition via BR14b-EX3)
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
- `BR14b-EX3 — Makefile target test-pkg-chat-core + packages/chat-core/tests/** in-memory adapter suite`
  - Rationale: SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5 mandates that "Each port must have an in-memory reference adapter shipped alongside the contract, so a downstream user can build without Postgres". Lots 9-15 migrated 13 orchestration methods to `ChatRuntime` without any unit test in `packages/chat-core/`. Final BR14b publish gate requires shippable quality, which means: (a) the 5 in-memory adapters mandated by §5 must exist under `packages/chat-core/src/in-memory/`, (b) a unit test suite must cover the 13 migrated `ChatRuntime` methods + the pure helpers in `history.ts`, and (c) a make target must run that suite in CI mirroring the existing `test-llm-mesh` Docker pattern.
  - Impact: Makefile +4 lines (one new `test-pkg-chat-core` target). `packages/chat-core/src/in-memory/**` 5 new files (~600 lines) + barrel re-export. `packages/chat-core/tests/**` 6 new test files (~1000 lines). `packages/chat-core/package.json` +2 devDependencies (`vitest`, `@vitest/coverage-v8`) + 2 scripts. No behavior change in existing chat-service.ts / postgres adapters / api/tests/. From Lot 16 onwards, every migrated `ChatRuntime` method MUST land with its accompanying unit test in this suite.
  - Rollback: revert the BR14b-EX3 commits; the `packages/chat-core/in-memory/` directory + `tests/` directory + Makefile target are pure additions and removing them leaves runtime / adapter / chat-service behavior untouched.

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

## Lot 15 - runAssistantGeneration Slice A migration (prepareAssistantRun)
- [x] Identify Slice A boundary in runAssistantGeneration (lines 1847-1893 pre-Lot 15: session lookup + workspace resolution + workspace-access flags + contexts normalisation + messages load + assistantRow precheck + conversation projection + lastUserMessage extraction; 47 lines, ends before title-generation side effect)
- [x] Define AssistantRunContext type in chat-core (+ PrepareAssistantRunOptions + WorkspaceAccessFlags)
- [x] Add ChatRuntime.prepareAssistantRun method (verbatim port of Slice A)
- [x] chat-service.ts runAssistantGeneration consumes AssistantRunContext at top
- [x] typecheck + tests PASS
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/chat-summary-runtime.test.ts PASS (2/2)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-batch-create-orgs.test.ts PASS (5/5)

## Lot 16a - runAssistantGeneration Slice B title-generation migration (ensureSessionTitle)
- [x] Identify Slice B boundary in runAssistantGeneration (lines 1889-2513 pre-Lot 16: title-gen 1889-1907 + context flags 1908-1944 + documents/comments resolution 1945-1983 + todo runtime snapshot 1984-2012 + tool catalog 2014-2174 + context blocks 2176-2452 + system prompt IIFE 2457-2513; 624 lines total)
- [x] Slice B is too large (>600 lines) for a single Lot 16; split into Lot 16a (title-gen only, this lot) + Lot 16b (full system prompt build, next lot)
- [x] Add `EnsureSessionTitleOptions` type in chat-core (mirrors session + workspace + focus + last user message fields from `AssistantRunContext`)
- [x] Add `ensureSessionTitle` callback to `ChatRuntimeDeps` (Option A; bundles generateSessionTitle + sessionStore.updateTitle + notifyWorkspaceEvent into one chat-service-side closure)
- [x] Add `ChatRuntime.ensureSessionTitle(options)` method that short-circuits when session already has a title or trimmed lastUserMessage is empty, then delegates to the callback
- [x] chat-service.ts constructor wires the `ensureSessionTitle` callback (binds to the existing `generateSessionTitle` private method + `postgresChatSessionStore.updateTitle` + `notifyWorkspaceEvent`)
- [x] chat-service.ts runAssistantGeneration replaces the inline title-gen block (19 lines pre-Lot 16) with `await this.runtime.ensureSessionTitle({...})` (10 lines)
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (8 files, 75/75 tests; runtime.ts coverage 85.62% lines; new runtime-system-prompt.test.ts 6/6 tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] Net code change: chat-service.ts -19/+45 (= +26 lines for constructor callback wiring), runtime.ts +0/+81 (types + method), tests +0/+178 (new file). Total commit budget respected (≤ 150 lines / commit, work split across 3 commits).

## Lot 16b - runAssistantGeneration Slice B system-prompt build migration (prepareSystemPrompt)
- [x] Identify Slice B remaining boundary post Lot 16a (lines 1946-2550, 605 lines: context flags + allowed-documents/comments resolution + todo runtime snapshot + tool catalog by context-type + workspace-type tool layer + server-side tab tool injection + documents block + context blocks per primary type + history block + todo orchestration block + active tools block + document_generate guidance block + system prompt IIFE)
- [x] Add `BuildSystemPromptInput` + `BuildSystemPromptResult` types in chat-core (16 result fields actually consumed downstream — narrowed from initial 28-field spec after grep of post-Slice-B consumption)
- [x] Add `PrepareSystemPromptOptions` (caller-side fields not in `AssistantRunContext`: requestedTools + localToolDefinitions + vscodeCodeAgent)
- [x] Add `buildSystemPrompt` callback to `ChatRuntimeDeps` (Option A; mandatory in spec but kept optional with throw in wrapper to mirror Lot 16a ensureSessionTitle pattern)
- [x] Add `ChatRuntime.prepareSystemPrompt(ctx, options)` method (trivial wrapper that maps ctx + options to BuildSystemPromptInput and delegates to callback)
- [x] Extract verbatim 605-line block from `runAssistantGeneration` into new private method `ChatService.buildSystemPromptInternal(input)`
- [x] Wire `buildSystemPrompt: (input) => this.buildSystemPromptInternal(input)` in constructor
- [x] Replace inline block in `runAssistantGeneration` with `await this.runtime.prepareSystemPrompt(ctx, {...})` + 16-field destructure (46 lines)
- [x] Drop unused `contextsOverride` Lot-15 destructure (now read from `input.contextsOverride` inside the method, not from outer scope)
- [x] Extend `packages/chat-core/tests/runtime-system-prompt.test.ts` with 7 new tests for `prepareSystemPrompt` (callback wiring, input mapping, result propagation, error propagation)
- [x] make typecheck-api PASS
- [x] make lint-api PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (8 files, 82/82 tests; runtime.ts coverage 85.76% lines, up from 84.78% pre-Lot 16b; +7 new tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts PASS (6/6)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts PASS (1/1)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts PASS (14/14)
- [x] Net code change: chat-service.ts +185/-57 (= +128 net for 605-line verbatim move + 46-line delegation + 10-line constructor + 3-line import + comment doc; method body is moved verbatim and git diff counts both insertion of the new method and removal of the inline block); runtime.ts +170 (types + callback + wrapper method); tests +210/-3 (Lot 16b suite). Work split across 3 commits (chat-core types/callback/wrapper, chat-service slice move, chat-core tests).

## Lot 15.5 - chat-core test infrastructure (BR14b-EX3)
- [x] Open BR14b-EX3 (Makefile target + packages/chat-core/tests/**)
- [x] Create 5 in-memory port adapters under packages/chat-core/src/in-memory/
- [x] Re-export in-memory namespace from packages/chat-core/src/index.ts
- [x] Add Makefile target `test-pkg-chat-core` mirroring `test-llm-mesh` Docker pattern
- [x] Add test + test:coverage scripts in packages/chat-core/package.json (vitest + @vitest/coverage-v8 are installed at runtime by the Makefile target into a tool_dir; not added to root package-lock to keep `npm ci` reproducible and to mirror the `test-llm-mesh` lock-free pattern)
- [x] Write packages/chat-core/tests/runtime-checkpoint.test.ts (Lot 11 coverage)
- [x] Write packages/chat-core/tests/runtime-message.test.ts (Lots 13 + 14a coverage)
- [x] Write packages/chat-core/tests/runtime-session.test.ts (Lot 14b coverage)
- [x] Write packages/chat-core/tests/runtime-tool-loop.test.ts (Lots 9 + 10 coverage)
- [x] Write packages/chat-core/tests/runtime-precheck.test.ts (Lot 15 coverage)
- [x] Write packages/chat-core/tests/history.test.ts (Lot 14b pure helpers)
- [x] Write packages/chat-core/tests/in-memory-adapters.test.ts (direct adapter coverage)
- [x] `make test-pkg-chat-core ENV=test-refacto-chat-service-core` PASS (7 files, 69/69 tests; runtime.ts 85.38% lines; in-memory adapters 94.08% lines)
- [x] `make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core` PASS (regression check)
- [x] `make test-api-unit SCOPE=tests/unit/chat-checkpoint-runtime.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core` PASS (2/2 tests)

## Lot 17 - runAssistantGeneration Slice C-1 dedup (resolveModelSelection reuse)
- [x] Locate inline 4-helpers block in `runAssistantGeneration` (chat-service.ts lines 2789-2808 post Lot 16b: settingsService.getAISettings + getModelCatalogPayload + inferProviderFromModelIdWithLegacy + resolveDefaultSelection, 20 lines)
- [x] Verify Lot 12 callback `resolveModelSelection` signature in runtime.ts (input `{userId, providerId?, model?}` → `{provider_id, model_id}`)
- [x] Add public wrapper `ChatRuntime.resolveModelSelection(input)` in runtime.ts (slim delegate to `this.deps.resolveModelSelection`; needed because `deps` is `private readonly`)
- [x] Replace inline 4-helpers block in `runAssistantGeneration` with `await this.runtime.resolveModelSelection({userId, providerId: options.providerId, model: options.model || assistantRow.model})` + cast `provider_id as ProviderId` (mirrors Lot 12 delegate pattern in retryUserMessage)
- [x] Imports `settingsService`, `getModelCatalogPayload`, `inferProviderFromModelIdWithLegacy`, `resolveDefaultSelection` retained (still consumed by the Lot 12 callback closure at chat-service.ts line 810)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (8 files, 82/82 tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] Net code change: chat-service.ts -19/+11 = -8 lines (20-line inline block removed, 12-line delegate + Lot-17 comment block added); runtime.ts +16 (slim public wrapper method); +8 net total. Pure dedup, behavior preserved.

## Lot 18 - runAssistantGeneration Slice C-2 reasoning effort evaluator migration
- [x] Locate reasoning-effort evaluator block in `runAssistantGeneration` (chat-service.ts lines 2806-2910 post Lot 17; bracketed by 2 status writeStreamEvent calls that STAY caller-side because `streamSeq` shared counter not yet migrated)
- [x] Add `ReasoningEffortLabel` + `EvaluateReasoningEffortInput` + `ReasoningEffortEvaluation` types in packages/chat-core/src/runtime.ts (result type extended with `evaluatorModel` so caller can preserve the legacy console.error trace shape `{assistantMessageId, sessionId, model, evaluatorModel, error}`)
- [x] Add optional `evaluateReasoningEffort` callback to `ChatRuntimeDeps` (Option A; mirrors Lot 16a/16b pattern)
- [x] Add `ChatRuntime.evaluateReasoningEffort(input)` wrapper method (when callback unwired returns `{shouldEvaluate:false, effortLabel:'medium', evaluatedBy:'fallback', evaluatorModel:null}`)
- [x] Extract 105-line evaluator body into private method `ChatService.evaluateReasoningEffortInternal(input)` in api/src/services/chat-service.ts (early-return for `shouldEvaluate=false` branch + verbatim try/catch with same callLLMStream call + invalid-token throw + fallback evaluatedBy/medium)
- [x] Wire `evaluateReasoningEffort: (input) => this.evaluateReasoningEffortInternal(input)` in constructor
- [x] Replace inline evaluation block in `runAssistantGeneration` with `await this.runtime.evaluateReasoningEffort({...})` + 2 caller-side `writeStreamEvent` calls around the runtime call + `console.error` trace caller-side on failure (same order as legacy code)
- [x] Add packages/chat-core/tests/runtime-reasoning-effort.test.ts with 7 cases (callback unwired fallback / non-reasoning model fallback non-gpt-5 / gpt-5 happy 'high' + openai routing / gemini happy 'low' + gemini routing / invalid token fallback + failure surfaced / mesh error event fallback + failure surfaced / input forwarding spy)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (9 files, 89/89 tests; runtime.ts coverage 85.62% lines; new runtime-reasoning-effort.test.ts 7/7 tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] Net code change: runtime.ts +141 (Lot-18 types + callback + wrapper method); chat-service.ts +196/-101 = +95 net (98-line evaluator body moved into private method `evaluateReasoningEffortInternal` + 50-line delegate with 2 caller-side status events + 13-line constructor wiring + 3-line type import); tests +290 (new file). Work split across 3 commits (chat-core types/callback/wrapper, chat-service block migration, chat-core tests).

## Lot 19 - runAssistantGeneration Slice C-3 steer helpers extraction
- [x] Locate inline helpers in `runAssistantGeneration` (chat-service.ts pre-Lot 19: `normalizeSteerMessage` line 2813-2816 = 4 lines, `consumePendingSteerMessages` closure line 2998-3018 = 21 lines; closure captured `options.assistantMessageId` as streamId + `lastObservedStreamSequence` cursor with in-place mutation)
- [x] Create `packages/chat-core/src/steer.ts` with verbatim ports: `normalizeSteerMessage(value: string): string` + `consumePendingSteerMessages({streamBuffer, streamId, sinceSequence}): Promise<{messages: string[], nextSinceSequence: number}>` (pure function — cursor mutation surfaced as `nextSinceSequence` return field)
- [x] Re-export from `packages/chat-core/src/index.ts` (mirror Lot 14b `history.js` re-export pattern)
- [x] Refactor chat-service.ts: drop inline `normalizeSteerMessage` definition + inline closure; import `consumePendingSteerMessages` from `../../../packages/chat-core/src/steer`; replace call site with `await consumePendingSteerMessages({streamBuffer: postgresStreamBuffer, streamId: options.assistantMessageId, sinceSequence: lastObservedStreamSequence})` + assign back `lastObservedStreamSequence = steerPoll.nextSinceSequence`
- [x] Drop unused `readStreamEvents` import from `./stream-service` (was only used by the deleted closure)
- [x] Add `packages/chat-core/tests/steer.test.ts` with 11 cases (5 for `normalizeSteerMessage` whitespace cases + 6 for `consumePendingSteerMessages` empty/non-steer/sequence-order/cursor/malformed-payload/non-steer-status cases)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (10 files, 100/100 tests; new steer.ts coverage 100% lines, 94.73% branches; new steer.test.ts 11/11 tests)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (6/6)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (25/25; regression check on stream-service free functions and `steer_received` event sequencing)
- [x] Net code change: steer.ts +109 (new pure helpers module + JSDoc); index.ts +1 (re-export); chat-service.ts +18/-26 = -8 net (4-line `normalizeSteerMessage` deleted + 21-line closure deleted + 13-line delegating call site + 1-line import + 1-line removed `readStreamEvents` from existing import + ~8 lines of explanatory Lot-19 comments); tests +215 (new file). Helper signature diverges from launch-packet spec: launch packet proposed `(input: unknown) => {text, occurredAt?} | null` and `Promise<{text, occurredAt?, sequence}[]>`, but verbatim port preserves chat-service.ts current types (`(value: string) => string` and `Promise<{messages: string[], nextSinceSequence: number}>`). Behavior preservation is the absolute contract per BR14b principle; helper extraction is the only purpose of this lot, not signature evolution.

## Lot 20 - StreamSequencer port + reasoning-effort bracketing reclaim
- [x] Design `StreamSequencer` port in `packages/chat-core/src/stream-sequencer-port.ts` (`allocate(streamId)` + `peek(streamId)`; mirrors checkpoint/message/stream/session isolation pattern)
- [x] Re-export port from `packages/chat-core/src/index.ts`
- [x] Create `packages/chat-core/src/in-memory/stream-sequencer.ts` (`InMemoryStreamSequencer`; `Map<streamId, number>` counter; monotonic per-stream allocate; peek returns 0 when never allocated; reset + snapshot helpers)
- [x] Re-export `InMemoryStreamSequencer` from `packages/chat-core/src/in-memory/index.ts`
- [x] Create `packages/chat-core/tests/stream-sequencer.test.ts` (6 cases: monotonic, per-stream isolation, peek-0-before-allocate, peek-last-after-allocate, reset, snapshot)
- [x] Create `api/src/services/chat/postgres-stream-sequencer-adapter.ts` (`PostgresStreamSequencer`; `allocate` delegates to `postgresStreamBuffer.getNextSequence`; `peek` SELECT MAX(sequence); singleton export `postgresStreamSequencer`)
- [x] Extend `ChatRuntimeDeps` in `packages/chat-core/src/runtime.ts` with `readonly streamSequencer: StreamSequencer`
- [x] Add `ChatRuntime.allocateStreamSequence(streamId)` + `peekStreamSequence(streamId)` slim public wrappers (cursor re-sync needed by `runAssistantGeneration`)
- [x] Reclaim the 2 caller-side `writeStreamEvent` bracketing calls into `ChatRuntime.evaluateReasoningEffort`: input requires `streamId`; the runtime allocates sequences via `deps.streamSequencer.allocate(streamId)` and appends `status:reasoning_effort_eval_failed` (when `failure`) + `status:reasoning_effort_selected` via `deps.streamBuffer.append`
- [x] Update `EvaluateReasoningEffortInput` to include `streamId`
- [x] chat-service.ts wires `streamSequencer: postgresStreamSequencer` in the runtime constructor
- [x] chat-service.ts `runAssistantGeneration` removes the 2 inline `writeStreamEvent` calls + the `streamSeq +=` mutations around `evaluateReasoningEffort`; re-syncs the local `streamSeq` cursor from `(await this.runtime.peekStreamSequence(options.assistantMessageId)) + 1` after the runtime call (the runtime appended 0/1/2 events internally depending on shouldEvaluate+failure branches)
- [x] Drop unused `reasoningEffortLabel` and `reasoningEffortBy` locals (now consumed inside the runtime itself)
- [x] Update 6 chat-core test fixtures (runtime-message, runtime-session, runtime-precheck, runtime-tool-loop, runtime-system-prompt, runtime-checkpoint, runtime-reasoning-effort) to inject `InMemoryStreamSequencer` into `ChatRuntimeDeps`
- [x] Extend `packages/chat-core/tests/runtime-reasoning-effort.test.ts` with bracketing coverage (7 new cases): 1-event happy path / 2-event failure-path-in-order / no-event callback-unwired / no-event non-reasoning-model / monotonic seq across multiple calls / per-streamId isolation / messageId set on row
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (11 files, 113/113 tests; stream-sequencer.ts coverage 100% lines / 100% branches; runtime.ts coverage 85.31%)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (25/25)
- [x] Net code change: stream-sequencer-port.ts +64 (new port); in-memory/stream-sequencer.ts +38 (new adapter); in-memory/index.ts +1, index.ts +1 (re-exports); postgres-stream-sequencer-adapter.ts +53 (new adapter); runtime.ts +154/-12 = +142 net (StreamSequencer DI + streamId on EvaluateReasoningEffortInput + reclaim of 2 status events inside `evaluateReasoningEffort` + `allocateStreamSequence` / `peekStreamSequence` public wrappers + docstring updates); chat-service.ts +21/-28 = -7 net (drop 2 `writeStreamEvent` bracketing calls + 2 `streamSeq += 1` mutations + 2 unused locals, add `streamId` to runtime input + `peek+1` re-sync + 1 import + Lot-20 comment); 6 chat-core fixtures +18 (mechanical `streamSequencer: new InMemoryStreamSequencer()` add); tests/stream-sequencer.test.ts +73 (new file, 6 cases); tests/runtime-reasoning-effort.test.ts +162 (new bracketing describe block, 7 cases). Work split across 4 commits per launch packet plan.

## Lot 21a - runAssistantGeneration tool-loop iteration setup (context-budget helpers + loop-state init)
- [x] Locate inline slice (chat-service.ts pre-Lot 21a): `writeContextBudgetStatus` closure line 3009-3037 = 29 lines (captured `streamSeq` + `lastBudgetAnnouncedPct` + `options.assistantMessageId`); loop-local state initialization lines 2896-2934 + 3001 = ~40 lines (19 mutable/const locals: `streamSeq`, `lastObservedStreamSequence`, `contentParts`, `reasoningParts`, `lastErrorMessage`, `executedTools`, `toolCalls`, `currentMessages`, `maxIterations`, `todoAutonomousExtensionEnabled`, `todoContinuationActive`, `todoAwaitingUserInput`, `iteration`, `previousResponseId`, `pendingResponsesRawInput`, `steerHistoryMessages`, `steerReasoningReplay`, `lastBudgetAnnouncedPct`, `contextBudgetReplanAttempts`, `continueGenerationLoop`). Launch-packet helpers `writeContextBudgetSnapshot` / `writeContextBudgetReplan` do not exist in the current codebase — only `writeContextBudgetStatus` matches the pre-Lot 21a closure inventory.
- [x] Create `packages/chat-core/src/context-budget.ts` with verbatim port: `ContextBudgetZone` + `ContextBudgetSnapshot` types lifted from `chat-service.ts` line 313-320; `writeContextBudgetStatus` pure helper (closure → function: cursor mutations surfaced as `WriteContextBudgetStatusResult.{appended, lastBudgetAnnouncedPct}`)
- [x] Re-export from `packages/chat-core/src/index.ts` (mirror Lot 19 `steer.js` + Lot 14b `history.js` pattern)
- [x] Refactor chat-service.ts: drop inline closure body; thin wrapper now delegates to `writeContextBudgetStatusPure({streamBuffer: postgresStreamBuffer, streamSequencer: postgresStreamSequencer, streamId: options.assistantMessageId, ...})` and re-syncs `streamSeq` from `runtime.peekStreamSequence(...) + 1` after the call (same pattern Lot 20 introduced around `evaluateReasoningEffort`); local `ContextBudgetZone` / `ContextBudgetSnapshot` aliases now re-export the chat-core types so the remaining ~10 chat-service references stay intact
- [x] Add `packages/chat-core/tests/context-budget.test.ts` with 6 cases (first-append payload shape, short-circuit on identical normal occupancy, append when zone is soft/hard at identical occupancy, extras merging, monotonic sequences across multiple appends, per-streamId isolation)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (12 files, 119/119 tests; new context-budget.ts coverage 100% lines / 100% branches / 100% funcs)
- [x] Define `AssistantRunLoopState` interface in `packages/chat-core/src/runtime.ts` (20 fields: `streamSeq`, `lastObservedStreamSequence`, `contentParts`, `reasoningParts`, `lastErrorMessage`, `executedTools`, `toolCalls`, `currentMessages`, `maxIterations`, `todoAutonomousExtensionEnabled`, `todoContinuationActive`, `todoAwaitingUserInput`, `iteration`, `previousResponseId`, `pendingResponsesRawInput`, `steerHistoryMessages`, `steerReasoningReplay`, `lastBudgetAnnouncedPct`, `contextBudgetReplanAttempts`, `continueGenerationLoop`); + helper value types `AssistantRunLoopMessage`, `AssistantRunLoopPendingToolCall`, `AssistantRunLoopExecutedTool`, `BeginAssistantRunLoopInput`
- [x] Add `ChatRuntime.beginAssistantRunLoop(input): Promise<AssistantRunLoopState>` method (verbatim port of chat-service.ts lines 2899-2937 + 3004 pre-Lot 21a; performs `streamBuffer.getNextSequence(assistantMessageId)` for the initial `streamSeq` cursor)
- [x] Refactor chat-service.ts: delete 39-line inline init block; replace with `const loopState = await this.runtime.beginAssistantRunLoop({...})` + per-field destructure preserving every existing identifier (so the ~200 downstream references stay untouched); drop separate `let continueGenerationLoop = true` post-`evaluateReasoningEffort` (now in loopState); remove now-unused `getNextSequence` import from `./stream-service` (was only consumed by the deleted inline init); cast `loopState.currentMessages` back to `ChatRuntimeMessage[]` for the api-side narrow union (chat-core uses the loose `AssistantRunLoopMessage` boundary type)
- [x] Add `packages/chat-core/tests/runtime-loop-state.test.ts` with 9 cases (verbatim-defaults shape, system-prompt prepend + conversation order, streamSeq from getNextSequence with existing events, lastObservedStreamSequence cap at 0, baseMaxIterations passthrough, todo-autonomous extension combinatorics, todoContinuationActive guard on hasActiveSessionTodo, resumeFrom projection into pendingResponsesRawInput, null defaults when resumeFrom undefined)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (13 files, 128/128 tests; runtime.ts coverage 85.31% → 85.75%; new runtime-loop-state.test.ts 9/9 PASS)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] Net code change: context-budget.ts +156 (new pure helper module); chat-core/index.ts +1 (re-export); runtime.ts +212 (AssistantRunLoopState + 3 value-helper types + BeginAssistantRunLoopInput + beginAssistantRunLoop method + docstrings); chat-service.ts +51/-41 = +10 net (delete 39-line inline init block + 4-line `let continueGenerationLoop = true` + getNextSequence import + 28-line `writeContextBudgetStatus` closure body; add 14-line beginAssistantRunLoop call + 20-line field destructure + 20-line chat-core context-budget import + thin helper wrapper); tests +198 (context-budget.test.ts 6 cases + runtime-loop-state.test.ts 9 cases). Work split across 4 commits per launch packet plan.

## Lot 21b - runAssistantGeneration mesh stream consumer extraction + streamSeq port migration
- [x] Locate inline slice (chat-service.ts pre-Lot 21b lines 3203-3384): per-iteration mesh stream consumer body — `try { for await (const event of callLLMStream({...})) { ... } } catch { ... }` + post-loop `if (shouldRetryWithoutPreviousResponse) { ... } if (steerInterruptionRequested) { ... }` blocks. Inventory: 1 `callLLMStream` call, 1 try/catch with `isPreviousResponseNotFoundError` predicate, per-event switch (done/error/content_delta/reasoning_delta/tool_call_start/tool_call_delta + default), steer-interrupt poll at the bottom of the inner loop, 7 `streamSeq +=` mutations within the slice (3239+3245 inner stream writes, 3325 steer-interrupt status, 3354 response-lineage-reset status, 3382 run-resumed-with-steer status). `useCodexTransport` is NOT consumed inside the slice (only in tool dispatch + pass2 downstream).
- [x] Add `packages/chat-core/src/mesh-errors.ts` with verbatim port of `isPreviousResponseNotFoundError(message)` predicate
- [x] Re-export from `packages/chat-core/src/index.ts`
- [x] Add `ConsumeAssistantStreamDoneReason` union + `ConsumeAssistantStreamRequest` + `ConsumeAssistantStreamInput` + `ConsumeAssistantStreamResult` types in `packages/chat-core/src/runtime.ts`
- [x] Add `ChatRuntime.consumeAssistantStream(input): Promise<ConsumeAssistantStreamResult>` method (verbatim port of chat-service.ts lines 3203-3384 pre-Lot 21b). All 5 `streamSeq +=` mutations inside the slice migrated to `await this.deps.streamSequencer.allocate(streamId)` + `await this.deps.streamBuffer.append(...)`. `STEER_REASONING_REPLAY_MAX_CHARS` lifted as module-level constant in runtime.ts. Steer poll uses `consumePendingSteerMessages` from `./steer.js`. Retry path matches via `isPreviousResponseNotFoundError` from `./mesh-errors.js`.
- [x] Refactor chat-service.ts: drop the 182-line inline mesh consumer block + the inline `isPreviousResponseNotFoundError` closure + the local `STEER_REASONING_REPLAY_MAX_CHARS` constant + the inline `let steerInterruptionRequested`/`let steerInterruptionBatch` + the unused destructured `lastObservedStreamSequence` local; replace with `await this.runtime.consumeAssistantStream({...})` delegating call + caller-side re-sync of `previousResponseId` / `pendingResponsesRawInput` / `currentMessages` / `lastErrorMessage` / `steerReasoningReplay` from `loopState` + `streamSeq` re-sync from `peekStreamSequence + 1` + post-call `continue` on `doneReason === 'retry_without_previous_response' | 'steer_interrupted'`. Removed unused `consumePendingSteerMessages` import.
- [x] Add `packages/chat-core/tests/runtime-stream-consumer.test.ts` (10 cases: content-delta accumulation + sequence; multi-delta + done + doneReason=normal; tool_call_start + tool_call_delta upsert; error event + lastErrorMessage + doneReason=error; previousResponseId capture from status; steer-interrupt mid-stream + doneReason=steer_interrupted + batch + currentMessages append + run_interrupted_for_steer/run_resumed_with_steer events; retry on previous-response-not-found + doneReason=retry_without_previous_response + response_lineage_reset event; non-PRNF catch re-throw; reasoning-delta + steerReasoningReplay accumulation; steerReasoningReplay clamp at 6000 chars; monotonic seq across all stream writes)
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing warnings)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (14 files, 139/139 tests; runtime.ts coverage 85.75% → 87.11%; mesh-errors.ts coverage 100%; new runtime-stream-consumer.test.ts 10/10 PASS)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (6/6)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (25/25)
- [x] Net code change: mesh-errors.ts +29 (new helper module); chat-core/index.ts +1 (re-export); runtime.ts +396 (4 ConsumeAssistantStream types + 268-line consumeAssistantStream method body + STEER_REASONING_REPLAY_MAX_CHARS module constant + imports of `isPreviousResponseNotFoundError` and `consumePendingSteerMessages`); chat-service.ts +45/-185 = -140 net (drop 182-line inline mesh consumer block + 7-line inline `isPreviousResponseNotFoundError` closure + 1-line `STEER_REASONING_REPLAY_MAX_CHARS` local + 2-line steer-interrupt locals + 1-line `lastObservedStreamSequence` destructure + 1-line `consumePendingSteerMessages` import; add 35-line `consumeAssistantStream` delegating call + 5-line cursor re-sync + 4-line Lot-21b comment + 2-line `continue` branches + 1-line `steerReasoningReplay` re-sync); tests +368 (new `runtime-stream-consumer.test.ts` 10 cases). All `streamSeq +=` mutations targeted by Lot 21b inside the mesh consumer slice (7 sites) successfully migrated to `await deps.streamSequencer.allocate(streamId)`. Work split across 5 commits (helper, types, method body, chat-service refactor, tests).

## Lot 21c - runAssistantGeneration tool-dispatch foundation (loop-state useCodexTransport + ExecuteServerTool types + consumeToolCalls shell)
- [x] Locate inline slice (chat-service.ts post-Lot 21b lines 3267-4889): tool-dispatch for-loop body. Inventory: 1622 inline lines (vs ~1465 launch-packet estimate), 42 streamSeq mutations within the slice (vs ~15 launch-packet estimate), ~30 distinct tool-name branches each emitting its own `tool_call_result` with custom payloads, 3 helper closures inline (`getOrganizationIdForFolder`, `isAllowedOrganizationId`, `markTodoIterationState`, `isExplicitConfirmation`), 2 caches (`orgByFolderId`, `allowedCommentContextSet`), heavy coupling to api-side helpers (`toolService`, `todoOrchestrationService`, `executeContextDocumentSearch`, `writeChatGenerationTrace`, `parseToolCallArgs`, etc.) — verbatim port of the per-tool bodies into chat-core is not tractable in a single ≤150-net-per-commit lot, so the per-tool dispatch body migration is deferred to Lots 21d/21e (see `## Deferred to Lot 21d/21e`).
- [x] Add `useCodexTransport: boolean` field to `AssistantRunLoopState` in `packages/chat-core/src/runtime.ts` (initialized from `BeginAssistantRunLoopInput.useCodexTransport ?? false`); surface the field as an optional input on `BeginAssistantRunLoopInput`. Used by the deferred tool-dispatch path to gate the `needsExplicitToolReplay` rawInput rebuild + the `previousResponseId = null` clear when transport is codex.
- [x] Wire chat-service.ts to set `loopState.useCodexTransport = useCodexTransport` after computing the boolean (post `beginAssistantRunLoop`, post `resolveModelSelection`). Behavior preservation: pre-Lot 21d the in-scope readers remain the existing `useCodexTransport` local at lines ~4867 / ~4872; the loopState field is set but not yet consumed.
- [x] Update `packages/chat-core/tests/runtime-loop-state.test.ts` with default-`false` assertion + 1 new case for the seeded `useCodexTransport: true` input.
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (14 files, 140/140 tests; runtime.ts coverage 87.11% maintained)
- [x] Net code change (commit 1): runtime.ts +25 (useCodexTransport field on AssistantRunLoopState + BeginAssistantRunLoopInput + initializer); chat-service.ts +10 (loopState.useCodexTransport assignment + Lot-21c comment); tests/runtime-loop-state.test.ts +9 (default + seeded assertions). Total +44 net.
- [x] Add 4 new chat-core types: `ExecuteServerToolInput` (15 fields opaque on the boundary — userId / sessionId / assistantMessageId / workspaceId / toolCall / streamSeq / currentMessages / tools / responseToolOutputs / providerId / modelId / enforceTodoUpdateMode / todoAutonomousExtensionEnabled / contextBudgetReplanAttempts / readOnly / signal); `ExecuteServerToolResult` (output / outputForModel / success / errorMessage / todoStateUpdate / contextBudgetReplan); `ConsumeToolCallsInput` (11 fields: streamId / loopState / localToolNames Set / sessionId / userId / workspaceId / providerId / modelId / tools / enforceTodoUpdateMode / readOnly / signal); `ConsumeToolCallsResult` (toolResults / responseToolOutputs / pendingLocalToolCalls / executedTools / shouldBreakLoop). Add `executeServerTool?: (input) => Promise<result>` optional callback to `ChatRuntimeDeps` (mirrors Lot 12/16a/16b Option A pattern).
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (post commit 2)
- [x] Net code change (commit 2): runtime.ts +130 (4 new type interfaces + executeServerTool callback on ChatRuntimeDeps; trimmed docstrings to fit the ≤150-net budget; concrete proof of contract — the types match the inline body's captured locals byte-for-byte so Lot 21d's verbatim port stays strict).
- [x] Add `ChatRuntime.consumeToolCalls` method with minimal shell body: empty-toolCalls short-circuit (sets `loopState.continueGenerationLoop = false` + returns `shouldBreakLoop: true`); for-loop with `signal?.aborted` check (throws `AbortError`); local-tool short-circuit (push into `pendingLocalToolCalls` + emit one `tool_call_result {status:'awaiting_external_result'}` event via `deps.streamSequencer.allocate` + `deps.streamBuffer.append`; advance `loopState.streamSeq`). Non-local dispatch path is a no-op until Lot 21d wires `deps.executeServerTool`. Add `parseToolCallArgsForRuntime` module-scope helper (verbatim duplicate of chat-service.ts line 265).
- [x] make typecheck-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (post commit 3)
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (14 files, 140/140 tests pre-tests-commit; runtime.ts coverage drops to 80.44% with consumeToolCalls uncovered — restored to ≥87% in commit 4 by the new tests)
- [x] Net code change (commit 3): runtime.ts +101 (consumeToolCalls method body 86 lines + parseToolCallArgsForRuntime helper 11 lines + class brace 1 line). Method is NOT yet invoked by chat-service.ts — Lot 21c is a foundation commit; Lot 21d extends with the full per-tool dispatch body + wires chat-service to call `await runtime.consumeToolCalls(...)`.
- [x] Add `packages/chat-core/tests/runtime-tool-dispatch.test.ts` (11 cases): empty-toolCalls returns `shouldBreakLoop:true` + `continueGenerationLoop=false`; abort-signal aborts before first iteration; local tool args parsed via verbatim `parseToolCallArgs` (object / empty-string / malformed-string); 2 local tools emit 2 monotonic `tool_call_result {status:'awaiting_external_result'}` events + advance `streamSeq` via `streamSequencer.allocate`; non-local tool name is a no-op (Lot 21d will dispatch); mixed local+non-local: only local emits an event; empty tool name skipped; custom streamId routes events correctly; toolCall.id preserved verbatim across `pendingLocalToolCalls` + event payload. Update existing `runtime-stream-consumer.test.ts` builder with the new `useCodexTransport: false` field to keep the `AssistantRunLoopState` literal type-safe.
- [x] make test-pkg-chat-core ENV=test-refacto-chat-service-core PASS (15 files, 151/151 tests; runtime.ts coverage 87.75% — restored above the pre-Lot 21c 87.11% baseline; new runtime-tool-dispatch.test.ts 11/11 PASS).
- [x] Net code change (commit 4): tests/runtime-tool-dispatch.test.ts +310 (new file, 11 cases); tests/runtime-stream-consumer.test.ts +1 (useCodexTransport: false added to existing builder). Total +311 (test additions, no orchestration logic).
- [x] make lint-api API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (0 errors; only pre-existing 184 warnings)
- [x] make test-api-endpoints SCOPE=tests/api/chat.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (28/28)
- [x] make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (6/6)
- [x] make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (1/1)
- [x] make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (4/4)
- [x] make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (14/14)
- [x] make test-api-unit SCOPE=tests/unit/stream-service.test.ts API_PORT=9071 UI_PORT=5271 MAILDEV_UI_PORT=1171 ENV=test-refacto-chat-service-core PASS (25/25)
- [x] Lot 21c total net code change across 4 commits: runtime.ts +256 (useCodexTransport field + 4 types + executeServerTool callback + consumeToolCalls method + helper); chat-service.ts +10 (loopState.useCodexTransport wire-up); tests +320 (1 new file +310, 2 existing builders +10). Total +586 insertions across 4 commits (44 + 133 + 105 + 314). Behavior preservation strict — chat-service.ts inline tool-dispatch loop body remains load-bearing (post-Lot 21b unchanged) so all 79 regression cases still pass.

## Deferred to Lot 21d/21e
- [ ] Lot 21d: design the `ExecuteServerToolInput`/`Result` types + `executeServerTool` callback (Option A bundle of api-side helpers); add `ChatRuntime.consumeToolCalls` orchestration shell (for-loop, abort check, empty toolCalls return, local-tool short-circuit with `pendingLocalToolCalls.push` + `awaiting_external_result` event); delegate per-tool execution to `deps.executeServerTool`. Migrate the catch-wrapper streamSeq sites (1 per iteration) to `deps.streamSequencer.allocate`. Inline tests against `InMemory*` adapters.
- [ ] Lot 21e: migrate the context-budget pre-tool gate (+ replan + escalation) into chat-core (uses Lot 21a `writeContextBudgetStatus`). Migrate the post-loop trace + todo refresh + `pendingLocalToolCalls` status emission (`awaiting_local_tool_results`) + `needsExplicitToolReplay` rawInput rebuild. Final ChatService.runAssistantGeneration size target ≤ 100 lines.

## Lot 21d - Step 0 inventory + DECISION POINT
- [x] Inventory of the inline per-iteration tool-dispatch body (chat-service.ts lines 3267-4732 post-Lot 21c, immediately following the `consumeAssistantStream` delegate at line 3247):
  - Total inline lines from `if (toolCalls.length === 0)` (3277) through the closing `}` of the for-loop catch (4732): 1466 lines
  - For-loop body itself (line 3374 `for (const toolCall of toolCalls)` through closing `}` at 4732): 1359 lines
  - Local-tool short-circuit (lines 3374-3392) ALREADY handled by Lot 21c `ChatRuntime.consumeToolCalls` shell — runtime needs to extend only the non-local branch (lines 3393-4732)
  - Pre-loop accumulator declarations (lines 3283-3293: `toolResults`, `responseToolOutputs`, `pendingLocalToolCalls`) and 3 closures + 2 caches captured from the outer `runAssistantGeneration` scope:
    - `orgByFolderId: Map<string, string|null>` cache (3294)
    - `getOrganizationIdForFolder(folderId)` async closure (3295-3311) using `toolService.getFolder`
    - `isAllowedOrganizationId(orgId)` async closure (3312-3319) using `allowedByType.organization` + `allowedFolderIds`
    - `allowedCommentContextSet: Set<string>` cache (3320-3322)
    - `lastUserMessage` const (3323) derived from `conversation`
    - `isExplicitConfirmation(text, confirmationArg)` sync closure (3325-3330) — pure helper
    - `markTodoIterationState(rawResult)` sync closure (3331-3372) — mutates `todoAwaitingUserInput` + `todoContinuationActive` from outer scope
  - Try/catch block at 4689-4732 (errorResult wrap → emit `tool_call_result {status:'error', error}` → push deferredResult-shaped accumulators → call `markTodoIterationState` when tool was `plan`)
  - 41 `streamSeq += 1` mutations within lines 3267-4732 (vs ~36 launch-packet estimate)
  - 30 distinct `else if (toolCall.name === 'tool_name')` branches (see grep at chat-service.ts line 3519-4670 enumerated): plan/read_initiative/update_initiative/organizations_list/organization_get/organization_update/folders_list/folder_get/folder_update/initiatives_list/executive_summary_get/executive_summary_update/matrix_get/matrix_update/plan-create/plan-update_plan/plan-update_task/comment_assistant/web_search/web_extract/documents/history_analyze/solutions_list/solution_get/proposals_list/proposal_get/products_list/product_get/gate_review/workspace_list/initiative_search/task_dispatch/document_generate/batch_create_organizations (+ unknown-tool throw fallback at 4681)
- [x] Captured-locals inventory (referenced by name inside lines 3393-4732, must cross the boundary via `ExecuteServerToolInput` or remain api-side via a method on `ChatService`):
  - Read-only from outer scope: `allowedByType`, `allowedCommentContexts`, `allowedFolderIds`, `assistantMessageId` (≡ `options.assistantMessageId`), `currentUserRole`, `lastUserMessage`, `primaryContextId`, `primaryContextType`, `selectedProviderId`, `selectedModel`, `sessionId` (≡ `options.sessionId`), `sessionWorkspaceId`, `userId` (≡ `options.userId`), `workspaceId` (callback-side), `tools`, `currentMessages`, `vscodeCodeAgentPayload`
  - Mutated by branches: `executedTools[]`, `toolResults[]`, `responseToolOutputs[]`, `streamSeq` (number), `todoAwaitingUserInput` (bool, via `markTodoIterationState`), `todoContinuationActive` (bool, via `markTodoIterationState`), `contextBudgetReplanAttempts` (number, context-budget gate)
  - Closures used: `writeContextBudgetStatus` (Lot 21a wrapper), `compactContextIfNeeded`, `getOrganizationIdForFolder`, `isAllowedOrganizationId`, `markTodoIterationState`, `isExplicitConfirmation`
- [x] DECISION POINT outcome: **Option A** — callback owns event emission AND all per-tool work. Runtime drives loop iteration + abort check + local short-circuit (already done in Lot 21c shell). Callback returns aggregated accumulator structs (`output`, `outputForModel`, `success`, `errorMessage`, `todoStateUpdate`, `contextBudgetReplan`) back to runtime for merging into result.
  - Rationale for departing from launch-packet recommendation of Option B: each of the 30 per-tool branches has a UNIQUE result envelope shape composed from per-branch api-helper return values (e.g. `comment_assistant` returns `{status, proposal, threads}` from `generateCommentResolutionProposal`; `batch_create_organizations` returns `{status, organizations, totalCreated, totalEnriched, totalFailed, workspaceId}`). Migrating these payload shapes into chat-core would force chat-core to either re-import every api helper (forbidden by SPEC §5 chat-core-stays-contract-free) or accept a stringly-typed `output: unknown` (which is what Option A already does).
  - Additionally: the context-budget pre-tool gate (lines 3406-3461) emits TWO events (a deferred `tool_call_result` + an optional `context_budget_user_escalation_required` status) BEFORE per-tool dispatch, and uses 2 closures (`writeContextBudgetStatus`, `compactContextIfNeeded`) captured from outer scope. This gate is explicitly Lot 21e scope per the launch packet ("post-loop blocks (4727-4889) — these are Lot 21e scope, DO NOT migrate") — but the context-budget gate is INSIDE the for-loop pre-tool block, NOT post-loop. Verification needed: launch packet wording is ambiguous; in practice the gate sits BETWEEN the for-loop start and the per-tool switch.
  - Net implication: Option A reduces Lot 21d to a verbatim move of the 1340-line per-tool body INTO `ChatService.executeServerToolInternal(input)`. The runtime extension is small (~80 lines extending `consumeToolCalls` non-local branch with `await this.deps.executeServerTool(...)` + accumulator merge).
- [x] **HALTED before code changes**: the 1340-line verbatim extraction requires structuring the input bundle (~25 fields including 3 closures bound to outer scope) AND threading mutable cursor state (streamSeq) AND mutable flags (todoAwaitingUserInput / todoContinuationActive / contextBudgetReplanAttempts) back through the result struct. Realistic implementation needs 8-10 commits at ≤150 net per commit and ≥30 minutes of focused unbroken context.
  - The context-budget gate is INSIDE the for-loop pre-tool block (lines 3406-3461), not post-loop. Decision needed: does Lot 21d include the gate migration, or does the callback receive `preToolBudget` + `projectedBudget` pre-computed inputs from the runtime?
  - Mutable cursor + flags threading via `loopState` is feasible (already established by Lot 21b/21c precedent) but the closure captures `markTodoIterationState` mutates 2 loopState fields. Wire-up: callback receives `loopState` reference; chat-service-side method body mutates loopState directly (mirrors how Lot 21b/21c handle `currentMessages` etc.).
  - Recommendation for follow-up agent: split Lot 21d into Lot 21d-1 (this commit — Step 0 inventory + DECISION POINT) + Lot 21d-2 (extract `ChatService.executeServerToolInternal` with rich input + return aggregated deltas) + Lot 21d-3 (wire callback + delete inline body + tests). Or alternatively: keep Lot 21d as-is and execute it in a fresh session with full context budget (recommended).

## Lot 21d-2 - executeServerToolInternal extraction (PURE CODE MOVEMENT)
- [x] Step 1: identify and document tool-branch groups for self-split (~6 branches per group). Branch line ranges (chat-service.ts post-Lot 21c, before any Lot 21d-2 migration):
  - **Group A** (6 branches, lines 3519-3638, ~120 lines): plan-validation-guard (3519); read_initiative (3526); update_initiative (3544); organizations_list (3571); organization_get (3589); organization_update (3611).
  - **Group B** (6 branches, lines 3639-3818, ~180 lines): folders_list (3639); folder_get (3661); folder_update (3681); initiatives_list (3708); executive_summary_get (3729); executive_summary_update (3749).
  - **Group C** (5 branches, lines 3820-4044, ~225 lines): matrix_get (3776); matrix_update (3793); plan-create (3820); plan-update_plan (3891); plan-update_task (3969).
  - **Group D** (5 branches, lines 4045-4286, ~240 lines): comment_assistant (4045); web_search (4109); web_extract (4128); documents (4153); history_analyze (4229).
  - **Group E** (10 branches, lines 4287-4356, ~70 lines): solutions_list (4287); solution_get (4296); proposals_list (4301); proposal_get (4310); products_list (4315); product_get (4324); gate_review (4329); workspace_list (4334); initiative_search (4339); task_dispatch (4348).
  - **Group F** (2 branches, lines 4357-4732, ~350 lines): document_generate (4357, 235 lines); batch_create_organizations (4592, 115 lines); plus the catch-wrapper at 4700-4732.
- [x] Step 2: scaffold `ChatService.executeServerToolInternal(input): Promise<ExecuteServerToolInternalResult>` private method with default branch only (throws `Unknown tool` mirroring inline 4681 fallback). Add chat-service-internal `ExecuteServerToolInternalInput` + `ExecuteServerToolInternalResult` types BEFORE `class ChatService`. Method is NOT yet invoked from `runAssistantGeneration` — inline switch remains the source of truth. `OpenAIChatLike` helper alias for `currentMessages`.
- [x] Step 2: typecheck PASS (no behavior change; method unreferenced; scaffold adds +145 lines net).
- [x] Step 3: Group A migration (commit 2). Migrated 5 tool branches `read_initiative` / `update_initiative` / `organizations_list` / `organization_get` / `organization_update` verbatim into `ChatService.executeServerToolInternal` switch. `plan-validation-guard` (the `if (toolCall.name === 'plan' && !todoOperation) throw` precondition at line 3601) stays inline — it is not a dispatchable tool body and will be subsumed by Group C when the `plan` branches migrate. Inline if/else-if chain delegates via a shared `buildExecuteServerToolInput` factory (DRY across the five Group A branches). Scaffold input type tightened to actual runtime shape: `allowedByType.{organization|folder|usecase|executive_summary}` → `ReadonlySet<string>`, `allowedFolderIds` → `ReadonlySet<string>`, `allowedCommentContextSet` → `ReadonlySet<string>`; added `hasContextType: (type: ChatContextType) => boolean` closure (consumed by `organizations_list` + future Group B `folders_list`). +202/−115 net. typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [ ] Step 3: Group B migration (commit 3).
- [x] Step 3: Group C migration (commit 4). Migrated 5 tool branches `matrix_get` / `matrix_update` / `plan(create)` / `plan(update_plan)` / `plan(update_task)` verbatim into `ChatService.executeServerToolInternal` switch. Inline if/else-if chain delegates via the existing `buildExecuteServerToolInput` factory (no new closures). Scaffold input extended: added `todoStructuralMutationIntent: boolean` (consumed by `plan(update_plan)` + `plan(update_task)` structural-mutation guard); tightened `sessionWorkspaceId: string | null` → `sessionWorkspaceId: string` (non-null guaranteed by `ChatRuntime.prepareAssistantRun`, required by `TodoActor.workspaceId: string`). Method-side destructure extended with `todoOperation` + `currentUserRole` + `enforceTodoUpdateMode` + `todoStructuralMutationIntent` + `markTodoIterationState`. `case 'plan':` dispatches by `input.todoOperation` (create/update_plan/update_task); falls through to caller-side `Unknown tool` for unknown todoOperation. +320/−266 net (+54). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [x] Step 3: Group D migration (commit 5). Migrated 5 tool branches `comment_assistant` / `web_search` / `web_extract` / `documents` / `history_analyze` verbatim into `ChatService.executeServerToolInternal` switch. Inline if/else-if chain delegates via the existing `buildExecuteServerToolInput` factory. Scaffold input extended: added `allowedDocContexts: Array<{contextType,contextId}>` (consumed by `documents`) + `allowedCommentContexts: Array<{contextType,contextId}>` (consumed by `comment_assistant`). Method-side destructure extended with `allowedCommentContextSet` + `allowedCommentContexts` + `allowedDocContexts` + `lastUserMessage` + `isExplicitConfirmation`. +295/−241 net (+54). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [x] Step 3: Group E migration (commit 6). Migrated 10 tool branches `solutions_list` / `solution_get` / `proposals_list` / `proposal_get` / `products_list` / `product_get` / `gate_review` / `workspace_list` / `initiative_search` / `task_dispatch` verbatim into `ChatService.executeServerToolInternal` switch. Inline if/else-if chain delegates via the existing `buildExecuteServerToolInput` factory (no new closures, no input-type extension). Method-side destructure unchanged (uses `toolCall` / `options` / `sessionWorkspaceId` / `currentUserRole` already destructured by Groups A-D). +130/−64 net (+66). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [x] Step 3: Group F1 migration (commit 7). Migrated `document_generate` (action=upskill + action=generate covering DOCX template / freeform DOCX / freeform PPTX branches) verbatim into `ChatService.executeServerToolInternal` switch. Inline if/else-if delegates via the existing `buildExecuteServerToolInput` factory (no new closures, no input-type extension). Method-side destructure extended with `primaryContextType` + `primaryContextId` (consumed by `resolveDocumentGenerateTarget`). +248/−239 net (+9). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [x] Step 3: Group F2 migration (commit 8). Migrated `batch_create_organizations` verbatim into `ChatService.executeServerToolInternal` switch. Inline if/else-if delegates via the existing `buildExecuteServerToolInput` factory. Method-side destructure extended with `selectedModel` (consumed by `OrganizationEnrichJobData.model`). Scaffold input tightened: `selectedModel: string | null` → `selectedModel: string` (non-null guaranteed by `ChatRuntime.resolveModelSelection`'s `{provider_id: string, model_id: string}` return, required by `OrganizationEnrichJobData.model: string | undefined`). +104/−90 net (+14). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.
- [x] Step 3: Group F3 migration (commit 9). Collapsed the inline if/else-if chain in `runAssistantGeneration` (30 per-tool branches) into a single delegation `const r = await this.executeServerToolInternal({...}); result = r.result; streamSeq = r.streamSeq;`. Removed `buildExecuteServerToolInput` factory closure (now inlined in the single call site). Removed the `else { throw new Error(\`Unknown tool: ${toolCall.name}\`) }` fallback — handled by the method's `default:` case. Updated method-header comment to reflect Step 3 completion (30/30 server-tool branches migrated verbatim). +23/−158 net (−135). typecheck-api PASS, lint-api PASS (0 errors), chat.test.ts 28/28 PASS, chat-tools.test.ts 6/6 PASS, chat-service-tools.test.ts 14/14 PASS.

## Lot 21d-3 - executeServerTool callback port boundary
- [x] Step 1 (commit 1, chat-core port + tests): added `ChatRuntime.executeServerTool(input: ExecuteServerToolInput): Promise<ExecuteServerToolResult>` public facade method to `packages/chat-core/src/runtime.ts`. Forwards verbatim to `deps.executeServerTool(input)` with a clear `not wired` error when the deps callback is undefined (lets test fixtures opt in without changing the Lot 21c optional field). The `ExecuteServerToolInput`/`Result` types + the `executeServerTool?` field on `ChatRuntimeDeps` already exist from Lot 21c — Lot 21d-3 wires the public facade so callers (`runAssistantGeneration`, future `consumeToolCalls` Lot 21e) cross the boundary through one runtime method rather than through the private `deps` reference. Added `packages/chat-core/tests/runtime-execute-server-tool.test.ts` with 13 unit cases: callback invoked verbatim with input; result returned unchanged; throws when not wired; rejection propagates; toolCall fields preserved; streamSeq cursor passes through; success:false / errorMessage envelope; todoStateUpdate marker forwarded; contextBudgetReplan flag forwarded; AbortSignal preserved (aborted state); full input contract forwarded (workspaceId/providerId/modelId/readOnly/enforce flags); single invocation per call (no internal retry/fan-out); tools + responseToolOutputs forwarded byte-by-byte. Net code change (commit 1): runtime.ts +32 (facade method + JSDoc), new test file +285 — total +317 insertions. `make test-pkg-chat-core` PASS 164/164 (151 pre-existing + 13 new).
- [x] Step 2 (commit 2, api wiring + delete inline call site): bound `executeServerTool: (input) => this.executeServerToolInternal(input as unknown as ExecuteServerToolInternalInput) as unknown as Promise<ExecuteServerToolResult>` in the `ChatService` constructor's `new ChatRuntime({...})` block, after the Lot 18 `evaluateReasoningEffort` binding. Replaced the inline `const r = await this.executeServerToolInternal({...})` call at lines 3651-3690 with `const r = await this.runtime.executeServerTool({...} as unknown as ExecuteServerToolInput); result = (r as unknown as ExecuteServerToolInternalResult).result; streamSeq = (r as unknown as ExecuteServerToolInternalResult).streamSeq;`. The chat-service-LOCAL `ExecuteServerToolInternalInput` (33 fields) is structurally widened to the chat-core opaque `ExecuteServerToolInput` (14 fields) via the explicit cast — preserves the boundary opacity decision recorded in Lot 21d-2 Step 3 follow-up notes. Updated imports to bring `ExecuteServerToolInput` + `ExecuteServerToolResult` types from `@sentropic/chat-core`. Method `executeServerToolInternal` body unchanged — it's still the api-side impl, but now invoked exclusively through the chat-core port boundary. Behavior preservation strict — the 30/30 server-tool dispatch + try/catch structure + caller-side accumulator pushes + context-budget gate (Lot 21e scope) are byte-identical to pre-Lot 21d-3.
- [x] Step 2: regression gates: `make typecheck-api ENV=test-refacto-chat-service-core` PASS, `make lint-api ENV=test-refacto-chat-service-core` PASS (0 errors, pre-existing warnings only), `make test-pkg-chat-core ENV=test-refacto-chat-service-core` PASS (164/164), `make test-api-endpoints SCOPE=tests/api/chat.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (28/28), `make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (6/6), `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (14/14).
- [x] Net code change (commit 2, BRANCH.md folded in): chat-service.ts +27/−13 = +14 net (constructor binding +20, inline call site comment refresh +5, imports +1, return cast +3, delegation call rename −9, deletion of old comment block −6). Lot 21d-3 total across 2 commits: +331 insertions / −13 deletions = +318 net (chat-core test file dominates). Behavior preservation strict — `runAssistantGeneration` for-loop body, try/catch, context-budget gate (Lot 21e scope), and caller-side accumulators all unchanged.
- [x] Step 4: final cleanup commit — verified inline dispatch body is delegation-only. Step 3 30/30 branches migrated, factory pattern applied universally (single inline object literal at the call site).
- [ ] Step 6: regression tests (FINAL)
  - [ ] `make typecheck-api` PASS
  - [ ] `make lint-api` PASS
  - [ ] `make test-pkg-chat-core` PASS (151/151 — unchanged)
  - [ ] `make test-api-endpoints SCOPE=tests/api/chat.test.ts` PASS (28/28)
  - [ ] `make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts` PASS (6/6)
  - [ ] `make test-api-endpoints SCOPE=tests/api/chat-summary-contract.test.ts` PASS
  - [ ] `make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts` PASS
  - [ ] `make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts` PASS
  - [ ] `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts` PASS (14/14)
  - [ ] `make test-api-unit SCOPE=tests/unit/stream-service.test.ts` PASS
- [x] **Decisions captured for Step 3 follow-up agent**:
  - **Input type**: chat-service-LOCAL `ExecuteServerToolInternalInput` rather than the chat-core `ExecuteServerToolInput`. Rationale: chat-core's type intentionally declares `tools` / `currentMessages` / `responseToolOutputs` as `ReadonlyArray<unknown>` (boundary opacity, preserved for Lot 21d-3 callback) and lacks api-side captured locals (`allowedByType` / `allowedFolderIds` / `allowedCommentContextSet` / `lastUserMessage` / `currentUserRole` / `primaryContextType` / `primaryContextId` / `sessionWorkspaceId` / `vscodeCodeAgentPayload` / `executedTools` / `iteration`) AND the 4 closures (`getOrganizationIdForFolder` / `isAllowedOrganizationId` / `markTodoIterationState` / `isExplicitConfirmation`). The chat-service-local type carries the full surface; Lot 21d-3 will bridge via Option A callback that binds closures + accumulator refs over `this`.
  - **Streaming side effect**: per-branch `writeStreamEvent` calls + `streamSeq += 1` mutations stay INSIDE the method body; method returns the post-mutation `streamSeq` via `ExecuteServerToolInternalResult.streamSeq` so caller updates its shared local cursor.
  - **Mutable state**: caller-side mutables (`todoAwaitingUserInput`, `todoContinuationActive`, `contextBudgetReplanAttempts`) are mutated via the captured closure `markTodoIterationState` (passed in `input`). No new return field needed.
  - **Try/catch structure**: the inline `try { ... } catch { ... }` STRUCTURE stays caller-side. Branches inside `executeServerToolInternal` may throw — the caller's catch continues to wrap them into `{status:'error',error}` and push into `toolResults` / `responseToolOutputs` / `executedTools`. This preserves byte-identical error-path behavior including the existing `todoErrorCall = toolCall.name === 'plan'` + `markTodoIterationState(errorResult)` path at lines 4705-4708.
  - **Context-budget gate**: STAYS caller-side at lines ~3406-3495 (the `continue` short-circuit happens BEFORE any call to `executeServerToolInternal`). Lot 21e migrates the gate.
  - **Migration step protocol**: each Group commit (a) moves the verbatim branch body INTO the `executeServerToolInternal` switch as a new `case 'tool_name':` (preserves byte-identical per-branch logic + writeStreamEvent calls + streamSeq mutations); (b) replaces the inline `else if (toolCall.name === 'tool_name') { ... }` block with a delegation `const r = await this.executeServerToolInternal({...}); result = r.result; streamSeq = r.streamSeq;`; (c) runs typecheck + targeted tests; (d) `make commit MSG="refactor(chat-service): migrate <names> into executeServerToolInternal (group N)"`.
  - **Args parsing in caller**: keep the existing `const args = JSON.parse(toolCall.args || '{}')` caller-side (line 3395) — pass `args` through `input.args` to avoid double-parsing. The plan-validation-guard branch at 3519 reads `toolCall.name === 'plan' && !todoOperation` — `todoOperation` is the caller's locally-computed value (lines 3497-3518); pass it through `input.todoOperation`.

## Lot 23 preview - chat-core integration test suite
- [x] Added `packages/chat-core/tests/integration/full-flow.test.ts` (635l, 5 integration scenarios) composing in-memory CheckpointStore / MessageStore / SessionStore / StreamBuffer / StreamSequencer / MeshDispatch adapters to exercise the full ChatRuntime end-to-end without api dependencies.
- [x] Verified against current chat-core API (post Lot 21d-3 `executeServerTool` facade): `make test-pkg-chat-core` PASS 169/169 (151 pre-existing + 13 Lot 21d-3 + 5 Lot 23 preview).
- [x] Scope: preview-only — full Lot 23 still pending (extended scenarios, error injection, multi-loop, checkpoint resume edge cases).

## Lot 21e-1 - applyContextBudgetGate chat-core method + tests
- [x] Step 0 scope analysis: gate block at `chat-service.ts` lines 3534-3636 (~102l, post-Lot 21d-3). Inputs consumed: `toolCall` (id, name), `args` (parsed), `currentMessages` + `tools` + `responseToolOutputs` + `selectedProviderId` + `selectedModel` (via `estimateContextBudget`), `streamSeq` cursor, `contextBudgetReplanAttempts` counter, `options.assistantMessageId`. Caller-side closures: `writeContextBudgetStatus` (Lot 21a wrapper, called BEFORE gate at line 3547, stays caller-side), `compactContextIfNeeded` (mutates `currentMessages`, calls api-side `compactConversationContext`). Pure helpers api-side: `estimateContextBudget`, `estimateToolResultProjectionChars`, `estimateTokenCountFromChars`, `resolveBudgetZone`, `CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS` / `CONTEXT_BUDGET_HARD_ZONE_CODE` / `CONTEXT_BUDGET_SOFT_ZONE_CODE` constants. Side effects: 2 stream events (deferred `tool_call_result` + optional `context_budget_user_escalation_required` status), accumulator pushes to `toolResults` / `responseToolOutputs` / `executedTools`, `continue` short-circuit on deferred branch. Mutations: `contextBudgetReplanAttempts += 1` (deferred branch) or `= 0` (passed gate), `preToolBudget` reassigned post-compaction, `streamSeq` advanced by 1 or 2 events. Design: method takes pre-computed `preToolBudget` + `projectedResultChars` (api helpers stay api-side), takes 3 callbacks (`resolveBudgetZone` / `estimateTokenCountFromChars` / `compactContextIfNeeded`) + 3 api-side constants (`maxReplanAttempts` / `softZoneCode` / `hardZoneCode`), emits events via `deps.streamSequencer.allocate` + `deps.streamBuffer.append` (same convention as Lot 21c `consumeToolCalls`), returns `{ shouldContinue, streamSeq, contextBudgetReplanAttempts, preToolBudget, deferredAccumulator? }` where `deferredAccumulator` carries the 3 rows the caller must push into accumulators.
- [x] Step 1 (commit 1, chat-core method + tests): added `ChatRuntime.applyContextBudgetGate(input: ApplyContextBudgetGateInput): Promise<ApplyContextBudgetGateResult>` public method to `packages/chat-core/src/runtime.ts`. Verbatim port of the inline gate (lines 3534-3636 of chat-service.ts post-Lot 21d-3): hard-zone compaction branch, soft-zone deferred branch, escalation status emission on `replanAttempts > maxReplanAttempts`, and reset-to-0 on normal-zone projection. Added `packages/chat-core/tests/runtime-context-budget-gate.test.ts` (414l, 11 unit cases): happy path (normal zone, no events) ; counter reset from non-zero ; soft-zone first attempt (single tool_call_result event, escalation_required=false) ; soft-zone deferredAccumulator payload (toolCallId/toolName/args verbatim + suggested_actions x2) ; hard-zone with successful compaction (gate passes, counter resets, preToolBudget post-compaction) ; hard-zone with failed compaction (gate fires deferred branch with hardZoneCode code) ; second hard attempt → escalation status event (streamSeq advances by 2) ; streamSeq invariant across 3 branches (0 / +1 / +2 sequencer allocations) ; soft+hard zone codes routed verbatim ; toolName fallback to `unknown_tool` on empty `toolCall.name` ; deferredResult payload carries projected occupancy + estimated_tokens + max_tokens from post-compaction snapshot.
- [x] Step 1: `make test-pkg-chat-core ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS 180/180 (169 pre-existing + 11 Lot 21e-1).
- [x] Step 1: `make typecheck-api ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (no api-side changes yet — the gate is unreferenced from chat-service.ts until Step 2).
- [x] Step 2 (commit 2, api wire + delete inline): replaced the inline gate block at `chat-service.ts` lines 3540-3636 with `const gate = await this.runtime.applyContextBudgetGate({...}); streamSeq = gate.streamSeq; contextBudgetReplanAttempts = gate.contextBudgetReplanAttempts; if (gate.shouldContinue) { /* push deferredAccumulator into toolResults / responseToolOutputs / executedTools + continue */ }`. The caller pre-computes `preToolBudgetInitial` via `estimateContextBudget(...)` and emits the `pre_tool` `writeContextBudgetStatus` event BEFORE invoking the gate (preserves the Lot 21a announce-once short-circuit semantics on `lastBudgetAnnouncedPct`). The runtime owns event emission via `deps.streamSequencer.allocate` + `deps.streamBuffer.append` (deferred `tool_call_result` + optional escalation status); the caller re-syncs `streamSeq` from `gate.streamSeq`. Behavior preservation STRICT — deferred-result payload shape, error code routing (`CONTEXT_BUDGET_SOFT_ZONE_CODE` / `CONTEXT_BUDGET_HARD_ZONE_CODE`), suggested_actions tuple, compaction-on-hard branch, and `contextBudgetReplanAttempts` `+= 1` / `= 0` semantics are byte-identical to pre-Lot 21e-1.
- [x] Step 2: net code change (commit 2, BRANCH.md folded in): chat-service.ts +46/−79 = −33 net (inline gate block −95l deleted, replaced with 41-line method call + accumulator pushes + comment block; the `let preToolBudget` local was also dropped since the post-compaction snapshot is consumed exclusively by the runtime now). New chat-service.ts size: 5346l (was 5379l).
- [x] Step 2: regression gates: `make typecheck-api ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS, `make lint-api ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (0 errors, 184 pre-existing warnings only), `make test-pkg-chat-core ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (180/180), `make test-api-endpoints SCOPE=tests/api/chat.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (28/28), `make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (6/6), `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (14/14). `make down ENV=test-refacto-chat-service-core ...` cleanup OK.
- [x] Lot 21e-1 total net code change across 2 commits: chat-core/runtime.ts +266 (types + method), chat-core/tests/runtime-context-budget-gate.test.ts +414 (11 unit cases), chat-service.ts +46/−79 = −33 net. Total +680/−79 = +601 net across 2 commits. Behavior preservation strict — all 28+6+14+180 regression cases pass; the gate body now lives in chat-core, the caller is a thin 41-line invocation + deferred-accumulator push site. Next: Lot 21e-2 for-loop body migration (post-loop trace + todo refresh + `pendingLocalToolCalls` status emission + `needsExplicitToolReplay` rawInput rebuild) per the launch packet.

## Lot 21e-2 - consumeToolCalls full per-tool dispatch loop body migration
- [x] Step 0 scope analysis: for-loop body at `chat-service.ts` lines 3514-3741 (228l, post-Lot 21e-1). Block structure: line 3515 abort check (already in Lot 21c shell); lines 3516-3532 local-tool short-circuit (already in shell); lines 3534-3603 try-block context-budget gate caller-side wiring (pre-compute `projectedResultChars` + `preToolBudgetInitial`, emit `pre_tool` status, invoke `runtime.applyContextBudgetGate`, push deferred accumulator + `continue` on `gate.shouldContinue`); lines 3604-3625 `todoOperation` derivation from `args.action` / `args.taskId` / `args.todoId`; lines 3626-3630 plan-without-action throw; lines 3631-3689 `runtime.executeServerTool` dispatch + `result` / `streamSeq` extraction via api-side `ExecuteServerToolInternalResult` cast; lines 3692-3706 success accumulator pushes (`executedTools` / `toolResults` / `responseToolOutputs`); lines 3707-3740 catch block (errorResult wrap + `todoErrorCall` check + `markTodoIterationState` invocation + `tool_call_result` event emission + accumulator pushes). Inputs surface to migrate: 3 api-side helpers (`estimateContextBudget` / `estimateToolResultProjectionChars` / `writeContextBudgetStatus`), 3 gate callbacks forwarded (`resolveBudgetZone` / `estimateTokenCountFromChars` / `compactContextIfNeeded`), 3 api-side constants (`CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS` / `CONTEXT_BUDGET_SOFT_ZONE_CODE` / `CONTEXT_BUDGET_HARD_ZONE_CODE`), 1 caller-side closure (`markTodoIterationState`), 1 ExecuteServerToolInput bundle builder (caller binds 33-field bundle including api-side closures via Option A cast). Outer state read: `currentMessages` snapshot, `responseToolOutputs` (in-flight accumulator), `tools`, `providerId`, `modelId`. Mutations to return: `streamSeq` (advanced per iteration), `contextBudgetReplanAttempts` (advanced or reset by gate), 4 accumulator deltas. Decision: design `ConsumeToolCallsInput` with 5 groups (per-call identity / gate / catch / executeServerTool builder / outer state snapshot) + `ConsumeToolCallsResult` adds `streamSeq` + `contextBudgetReplanAttempts` cursors. Scope estimate: ~205l moved + ~50l type extensions + ~350l tests = within "slight relax for complex migration" budget.
- [x] Step 1 (commit 1, chat-core method body + tests): extended `ChatRuntime.consumeToolCalls` from the Lot 21c orchestration shell (empty-toolCalls short-circuit + local-tool branch) to own the full per-tool dispatch loop body. Verbatim port of `chat-service.ts` lines 3534-3741 into the method: pre-tool context-budget gate (pre-compute via caller-supplied helpers + `pre_tool` status emission + invocation of `this.applyContextBudgetGate` + deferred-accumulator push on `shouldContinue`); `todoOperation` derivation (verbatim 22-line IIFE from line 3604-3625); plan-without-action throw; per-tool dispatch via `this.executeServerTool` (Lot 21d-3 facade); success accumulator pushes; catch-block error wrap + `todoErrorCall` marker invocation + `tool_call_result` event emission + accumulator pushes. Extended `ConsumeToolCallsInput` with 5 groups of fields (per-call identity / gate-related / catch-related / executeServerTool builder / outer state snapshot — 18 new fields). Extended `ConsumeToolCallsResult` with `streamSeq` + `contextBudgetReplanAttempts` cursors. Behavior preservation STRICT — every event payload, every accumulator push order, every cursor mutation, the `todoErrorCall` plan-name gating, and the `executeServerTool` return cast trick (api-side returns `{ result, streamSeq }` but is typed as chat-core `ExecuteServerToolResult` per Lot 21d-3 boundary opacity) are byte-identical to pre-Lot 21e-2.
- [x] Step 1: extended `packages/chat-core/tests/runtime-tool-dispatch.test.ts` from 11 Lot 21c shell cases to 22 cases (10 pre-existing kept, 1 updated to use stubbed `executeServerTool` for the empty-name branch, 11 new Lot 21e-2 cases): single non-local tool dispatch with success accumulator alignment ; catch-block error envelope on `executeServerTool` rejection ; `markTodoIterationState` invocation on plan-tool failure when `todoAutonomousExtensionEnabled=true` ; `markTodoIterationState` skipped when `todoAutonomousExtensionEnabled=false` ; `markTodoIterationState` skipped on non-plan tool failures ; multiple non-local tools dispatched sequentially preserving order + accumulator alignment ; plan-without-action error wrapped through the try/catch ; `todoOperation` derivation from `args.taskId` / `args.todoId` / args-without-action ; `pre_tool` `writeContextBudgetStatus` event per dispatch ; deferred-accumulator push when gate fires (soft zone) — `executeServerTool` skipped, accumulators populated by gate, `contextBudgetReplanAttempts` incremented ; mixed local + server iteration (local short-circuits + server dispatches in same loop) ; mid-loop abort via `signal` flipped inside `executeServerTool` callback ; advanced `streamSeq` + reset `contextBudgetReplanAttempts` returned in result on gate pass.
- [x] Step 1: `make test-pkg-chat-core ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS 191/191 (180 pre-existing + 11 Lot 21e-2 new; runtime.ts coverage 87.97%, above the 87.11% Lot 21c baseline).
- [x] Step 1: `make typecheck-api ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS (no api-side changes yet — the extended method signature is unreferenced from chat-service.ts until Step 2; existing Lot 21d-3 + 21e-1 wiring stays intact).
- [x] Step 1: net code change (commit 1): chat-core/runtime.ts +420/−96 = +324 net (types extension +99 / method body +225), chat-core/tests/runtime-tool-dispatch.test.ts +523/−96 = +427 net (12 new tests + builder fixture extension for 18 new input fields). Total +943/−192 = +751 net for commit 1. Per the launch packet "slight relax for complex migration" — the runtime body is +225 (the verbatim port of the for-loop body); tests are +427 (the 12 new cases dominate). Method is NOT yet invoked from chat-service.ts — Step 2 will wire it + delete the inline for-loop body.
- [x] Step 2 (commit 2, api wire + delete inline for-loop body): replaced the inline for-loop body at `chat-service.ts` lines 3514-3741 (228l) with a single `const consumed = await this.runtime.consumeToolCalls({...});` invocation followed by 6 state-sync lines (`toolResults.push(...consumed.toolResults); responseToolOutputs.push(...consumed.responseToolOutputs); pendingLocalToolCalls.push(...consumed.pendingLocalToolCalls); executedTools.push(...consumed.executedTools); streamSeq = consumed.streamSeq; contextBudgetReplanAttempts = consumed.contextBudgetReplanAttempts;`). The pre-loop closures `getOrganizationIdForFolder` / `isAllowedOrganizationId` / `allowedCommentContextSet` / `lastUserMessage` / `isExplicitConfirmation` / `markTodoIterationState` stay caller-side (the for-loop's outer-scope locals like `todoAwaitingUserInput` / `todoContinuationActive` mutated by `markTodoIterationState` must remain bindable to the chat-service `let` slots). They are bound into the `buildExecuteServerToolInput` closure passed to `consumeToolCalls`. The Lot 21d-3 `as unknown as ExecuteServerToolInput` cast trick is preserved verbatim. Lot 21e-1's caller-side `applyContextBudgetGate` invocation site is also deleted — the gate is now invoked from inside `consumeToolCalls`. The Lot 21c local `parseToolCallArgs` helper at chat-service.ts line 268 was deleted (last reference removed; the runtime carries its own `parseToolCallArgsForRuntime` module-scope helper).
- [x] Step 2: net code change (commit 2, BRANCH.md folded in): chat-service.ts +82/−207 = −125 net (228-line inline for-loop body block replaced with 95-line `consumeInput` literal + 6-line state-sync block; 1-line `ConsumeToolCallsInput` import added; 11-line unused `parseToolCallArgs` helper deleted). New chat-service.ts size: 5221l (was 5346l). `runAssistantGeneration` function size: 1046l (was ~1174l pre-Lot 21e-2; saved ~128 lines).
- [x] Step 2: regression gates: `make typecheck-api ENV=test-refacto-chat-service-core API_PORT=9070 UI_PORT=5270 MAILDEV_UI_PORT=1170` PASS, `make lint-api ENV=...` PASS (0 errors, 184 pre-existing warnings only), `make test-pkg-chat-core ENV=...` PASS (191/191; 180 pre-Lot 21e-2 + 11 Lot 21e-2 new), `make test-api-endpoints SCOPE=tests/api/chat.test.ts ENV=...` PASS (28/28), `make test-api-endpoints SCOPE=tests/api/chat-tools.test.ts ENV=...` PASS (6/6), `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts ENV=...` PASS (14/14).
- [x] Lot 21e-2 total net code change across 2 commits: chat-core/runtime.ts +420/−96 = +324 net, chat-core/tests/runtime-tool-dispatch.test.ts +523/−96 = +427 net, chat-service.ts +82/−207 = −125 net. Total +1025/−399 = +626 net across 2 commits. Behavior preservation STRICT — all 28+6+14+191 = 239 regression cases pass; the for-loop body now lives in chat-core, the caller is a 101-line invocation site (95-line `consumeInput` literal building + 6-line state-sync block). Next: Lot 21e-3 post-loop blocks (`writeChatGenerationTrace` for executed tools + todo refresh + `pendingLocalToolCalls` `awaiting_local_tool_results` status emission + `needsExplicitToolReplay` rawInput rebuild) + finalize + done event per the launch packet.

