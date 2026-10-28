# Feature: P1a — Extract the Sentropic chat runtime foundation

## Objective
- [ ] Complete P1 under `spec/CHAT_MIGRATION_P0*.md`: preserve supported behavior while separating Sentropic runtime from the injected conversation view.

## Scope / Guardrails
- [x] Branch `feat/chat-convergence-p1`, based on `origin/main`; worktree `tmp/worktrees/chat-p1`.
- [x] Environment `test-chat-p1`; API_PORT=8796 UI_PORT=5196 MAILDEV_UI_PORT=1096; ENV always last.
- [x] Serialize Docker work with `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; run `make down` after each step.
- [x] Make targets only; no Python, dev tests, clean-all, rebase, force-push, publication or merge.
- [x] Selective staging and `make commit`; each commit at most 150 changed lines, excluding unchanged renames.
- [x] Keep the explicit `() => false` as the default authorization predicate; missing approval must deny execution.
- [x] Draft sequence to main: P1a runtime foundation/import migration; P1b injected conversation/optional-module boundary and parity.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/chat-runtime/**`
  - `packages/chat-ui/**`
  - `packages/chat-server/tests/wire-contract.spec.ts`
  - `packages/cowork-bridge/**`
  - `packages/cowork-desktop/**`
  - `ui/src/**`
  - `ui/tests/**`
  - `ui/vscode-ext/**`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `package-lock.json`
  - `scripts/ci/**`
  - `spec/CHAT_MIGRATION_P1.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `.cursor/rules/**`
  - `api/src/**`
  - `api/drizzle/**`
  - `spec/CHAT_MIGRATION_P0*.md`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] Declare rationale, impact and rollback before changing conditional paths.

## Feedback Loop
- [x] BR1-R1: boundary review APPROVE; packaging findings accepted: include LICENSE, make the temporary UI type peer optional and explicitly enumerate runtime subpaths; align the host export test and handle string-valued export entries.
- [x] BR1-EX1: allow additive Makefile runtime build/typecheck/test/pack targets and necessary chat dependency wiring; impact is package tooling only; rollback restores existing targets and removes runtime targets.
- [x] BR1-EX2: allow CI runtime validation and package release wiring; impact is required runtime gates/bootstrap preparation; rollback removes this additive lane, without publication.
- [x] BR1-N1 resolved: harness requires numeric exception IDs; corrected P1-prefixed IDs after the first advisory scope failure.
- [x] Track is single-writer: maintain this mergeable branch artifact; conductor imports it into Track.

## AI Flaky tests

## Orchestration Mode (AI-selected)
- [x] Multi-branch draft sequence when necessary; author owns implementation and integration; merge only.

## UAT Management (in orchestration context)
- [x] Automated qualification uses the isolated test environment; personal owner UAT/transfer GO remains U0.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read master/workflow/testing rules, P0 ownership/closure and P1 row.
  - [x] Create requested worktree and pass `harness check branch`.
  - [x] Fix environment, Docker lock, scope and atomic commit policy.
- [ ] **Lot 1 — Runtime package and physical ownership**
  - [x] Create `packages/chat-runtime/package.json`, `tsconfig.json` and public entrypoints.
  - [x] Move client transport/replay/history/stream hub and their tests without behavior changes.
  - [x] Migrate client consumers to public runtime subpaths; reserve chat-ui 1.0.0 above registry 0.34.1; runtime registry returns 404.
  - [x] Remove client entries from the visual export snapshot; retarget moved host export assertions to the runtime wildcard entry.
  - [ ] Move draft/attachment/projection/controller/session/checkpoint/local-tool implementation and tests; delete original implementations.
  - [x] Relocate the existing draft/attachment/projection/controller/session implementation and core parity tests unchanged.
  - [x] Relocate local-tool store, checkpoints, steer/scope helpers and principal-scoped view-marker persistence with existing tests.
  - [x] Reference neutral visual contracts through public type exports; the runtime imports no visual implementation.
  - [x] Redirect visual timeline/composer model consumers to relocated public runtime contracts.
  - [x] Migrate app and cowork execution consumers and corresponding import-boundary assertions to runtime.
  - [x] Move raw stream fixtures and the checkpoint barrel with runtime parity tests; preserve fixture bytes.
  - [x] Remove session/controller/projection exports from the visual manifest snapshot.
  - [x] Remove local-tool/persistence exports from the visual snapshot; runtime typecheck and 301 tests pass.
  - [x] Migrate VSCode and package test imports to runtime tool/projection modules.
  - [x] Resolve visual export failures: remove relocated checkpoint export, migrate consumers and align major-version assertions; keep consumer scan strict.
  - [x] Gate runtime typecheck/tests/pack in the existing chat CI lane; register the guarded runtime pack target without publishing.
  - [x] Reserve cowork-desktop 0.2.1 above registry 0.2.0 for its runtime import migration; visual unit tests 676/676 and DOM tests 219/219 pass.
  - [ ] Migrate inventoried web/Chrome/VSCode/cowork imports and active tooling links.
  - [ ] Split neutral contracts and optional module state from views; runtime never imports a view implementation.
  - [ ] Qualify breaking chat-ui version and initial runtime version against registry; update lockfiles.
- [ ] **Lot 2 — Injected conversation and complete command binding**
  - [ ] Replace component runtime creation/disposal with normalized snapshot and command props/declarations.
  - [ ] Bind full send/model/context/tools/attachments, history, retry/stop/edit/feedback/steer and active modules.
  - [ ] Enforce visible permission pending/denied state; approval executes/posts once; no adapter, denial and timeout execute zero times.
  - [ ] Preserve host lifetime across remounts; retain explicit default `() => false` authorization.
- [ ] **Lot 3 — Parity and packed boundary qualification**
  - [ ] Runtime tests: relocated `transport.test.ts`, `replay.test.ts`, `streamHub.test.ts`, `stream-history-bounds.test.ts`, `stream-throughput.test.ts`, `chat-core-host.spec.ts`.
  - [ ] Runtime tests: relocated `chat-loop-controller.spec.ts`, `chat-session-runtime.test.ts`, `chat-session-hydration.test.ts`, `chat-projection.test.ts`, `projection.golden.spec.ts`.
  - [ ] Runtime tests: relocated `chat-draft.test.ts`, `chat-attachments.test.ts`, `local-tools-store.test.ts`, `checkpoints.spec.ts`, `model-selection.spec.ts`, `agents-view-markers.test.ts`.
  - [ ] Optional module tests: `comments-module.spec.ts`, `documents-module.spec.ts`, `documents-attachment-state.test.ts`, `documents-generated-file-cards.test.ts`, `context.spec.ts`, `chat-context.spec.ts`, `web-host.test.ts`, `host-adapter-types.test.ts`.
  - [ ] UI tests: `chat-conversation-functional.dom.spec.ts`, `chat-conversation.dom.spec.ts`, `chat-conversation.spec.ts`; injected standalone and app-shaped fixtures use the same runtime.
  - [ ] Add runtime permission/continuation and remount parity tests with real controller/projection; no command stubs in parity fixtures.
  - [ ] Run package typecheck, unit/DOM tests, app typecheck/lint and affected app tests.
  - [ ] Pack both candidates and prove runtime-free UI and standalone installed consumption.
- [ ] **Lot 4 — Docs consolidation and review**
  - [ ] Record pair versions, breaking imports, package bootstrap/OIDC prerequisites and consumer notices in `spec/CHAT_MIGRATION_P1.md`.
  - [x] Document P1a candidate versions/import notices and the remaining P1b acceptance boundary in `spec/CHAT_MIGRATION_P1.md`.
- [ ] **Lot 5 — Draft handoff**
  - [ ] Run `make down ENV=test-chat-p1` and report PR URLs and head SHAs.
