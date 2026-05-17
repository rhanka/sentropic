# Feature: BR-26 Flow Runtime Extraction (façade-first)

## Objective
Extract `todo-orchestration.ts` + `queue-manager.ts` + `default-workflows.ts` + `gate-service.ts` into a publishable `@sentropic/flow` package via a façade-first migration: scope inventory, golden traces capture, façade layer, then progressive slice extraction without behavioral regression. Preserve agent templating (`promptTemplate` + `agentSelection`) and all SPEC_STUDY_AGENT_AUTONOMY_INCREMENTS §4 invariants.

## Scope / Guardrails
- Scope limited to the flow runtime domain (workflow definitions/runs, job queue, transitions, gates, agent templating bindings).
- One migration max in `api/drizzle/*.sql` (only if a slice proves a schema change unavoidable, under `BR26-EX1`).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/entropiq` reserved for user dev/UAT (`ENV=dev`).
- Branch development runs in isolated worktree `tmp/feat-flow-runtime-extract`.
- Automated tests run on `ENV=test-feat-flow-runtime-extract` / `ENV=e2e-feat-flow-runtime-extract`, never on root `dev`.
- `ENV=<env>` is always passed as the last argument of every `make` command.
- All new text in English.
- Branch slot: branch number `26`, slot `0` → API `9130`, UI `5330`, Maildev `1230`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/**`
  - `api/src/services/todo-orchestration.ts` (Lot 4+)
  - `api/src/services/queue-manager.ts` (Lot 5+)
  - `api/src/services/todo-runtime.ts`
  - `api/src/services/gate-service.ts`
  - `api/src/services/flow/**` (new façade adapters, Lot 3+)
  - `api/src/config/default-workflows.ts`
  - `api/src/config/default-agents.ts`
  - `packages/flow/**` (new package, Lot 2+)
  - `packages/contracts/**` (only if `TenantContext`/`IdempotencyKey` are needed, under `BR26-EX1`)
  - `packages/events/**` (only if `EventEnvelope` is needed, under `BR26-EX2`)
  - `api/tests/fixtures/golden/br26/**` (Lot 1)
  - `api/tests/services/flow/**` (regression tests per slice)
  - `api/src/db/schema.ts` (Lot 1+ only if columns need to be added — index hints / version bumps)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/services/chat-service.ts` (consumer; only call-site updates allowed under `BR26-EX3`)
  - `api/src/services/chat-core/**`
  - `packages/llm-mesh/**`
  - `ui/**`
  - Any `plan/NN-BRANCH_*.md` other than this branch file.
- **Conditional Paths (allowed only with explicit `BR26-EXn` exception)**:
  - `api/drizzle/*.sql` (max 1 file — `BR26-EX1`)
  - `.github/workflows/**` (`BR26-EX4` if matrix split needs adjustment for new test suite)
  - `api/src/services/chat-service.ts` (`BR26-EX3` for call-site rebinding through the façade)
  - `packages/contracts/**`, `packages/events/**` (`BR26-EX1`/`BR26-EX2`)
- **Exception process**:
  - Declare exception ID `BR26-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR26-Q1** (Lot 4 Slice 1, status: `deferred`): tightening `PostgresApprovalGate.signal(runId, decision)` to consume the `decision` argument (gate-aware approval/rejection branching) would change observable behavior of `resumeRun` (today resume is unconditional after pause). BR-26 is contractually a **behavior-preserving extraction** (replay must stay byte-identical). `signal()` therefore stays advisory in Lot 4 Slice 1 — the boundary is locked at the type level (`GateDecision` accepted) but the parameter remains `_decision` until the gate-aware path lands in a follow-up branch (BR-27 or Lot N-3 under `BR26-EX3`). Recorded by Lot 4 Slice 1 sub-agent.
- **BR26-EX5** (Lot 3, scope exception): `api/Dockerfile` is added to the touched paths. Reason: activating `@sentropic/flow` as an api workspace dependency (per `rules/architecture.md` "package extraction must be activated by real app consumption") requires (i) copying `packages/flow/package.json` into the base stage's pre-`npm ci` workspace shape and (ii) building `@sentropic/flow` after `COPY . .` so its `dist/index.d.ts` exists for the api `tsc --noEmit` typecheck. Mirrors the existing pattern for `@sentropic/llm-mesh`. Impact: 2 line additions in `api/Dockerfile`. Rollback: revert the diff if the package activation is rolled back.
- **BR26-EX6** (Lot 5, scope exception): `Makefile` is added to the touched paths. Reason: Lot 5 promotes `@sentropic/flow` from type-only re-exports (Lot 3) to value re-exports (`WORKSPACE_TYPE_WORKFLOW_SEEDS`, `getWorkflowSeedsForType`, workflow constants). Dev/test runtime mounts host repo over the container (`./:/workspace`), hiding the in-image dist; the host `packages/flow/dist` must therefore be populated by `make` before `up-api-test` / `up-api-test-ci`. Mirrors the existing `build-llm-mesh` pattern: adds `build-flow` + `typecheck-flow` targets and chains `build-flow` from `prepare-node-workspace` and `up-api-test-ci`. Impact: ~10 line additions in `Makefile`. Rollback: revert the diff if the seed catalog is reverted to `api/src/config/`.
- **BR26-FB-02** (Lot 5, severity: `attention`, status: `resolved/deferred`): the agent seed catalog move into `@sentropic/flow/seeds/agents` cannot be a single-file pure-data relocation. `api/src/config/default-agents.ts` (69 LOC) only orchestrates 5 sibling files (`default-agents-ai-ideas.ts` 474 LOC, `default-agents-opportunity.ts` 522 LOC, `default-agents-code.ts` 28 LOC, `default-agents-shared.ts` 313 LOC, `default-agents-types.ts` 11 LOC) which themselves import from `default-chat-system.ts` and `default-org-aware-prompts.ts` (prompt fragments, not in scope for the flow façade). Moving just the umbrella creates a cross-package upward import (`packages/flow → api/src/config/...`) which violates `rules/architecture.md` ("packages/* MUST NOT depend on app roots"). Moving the full agent catalog tree requires moving prompt fragments too — that scope expansion is incompatible with the BR-26 "behavior-preserving extraction" boundary and is deferred to BR-27. Recorded by Lot 5 sub-agent; conductor decision on 2026-05-17: keep BR-26/BR-32 behavior-preserving and workflows-only for Lot 5, then resume Lot 6 after Lot 5 workflow gates.
- **BR26-FB-01** (Lot 2, severity: `attention`, status: `resolved`): baseline `29b2c243` predates `origin/main` security fixes (`fix/security-high-vulnerabilities` merged at `edbe7d24`). The api Dockerfile audit gate (`npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root`) fails on this branch as soon as any change invalidates the Docker layer cache, due to the Svelte `devalue` high-severity advisory (GHSA-77vg-94rm-hx3p). Lot 2 lockfile addition for `@sentropic/flow` triggers cache invalidation, surfacing the failure. Resolution path: rebase the branch onto `origin/main` (picks up vite/flatted/fast-xml-builder/svelte fixes) before Lot 3 or earlier. Recorded by Lot 2 sub-agent; deferred to conductor decision. **Resolved at Lot 3 by merge commit `4e9209cb` (Lot 3 baseline) which incorporates `origin/main` PR #152 + PR #157 (vite, flatted, fast-xml-builder, sveltekit/devalue HIGH advisories).**

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in this file; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (sub-agents work in dedicated lot scopes inside this single worktree; one final test cycle).
- [ ] **Multi-branch**
- Rationale: the extraction is a single linear refactor with a strict slice order; CI value is one final regression cycle on the integrated façade.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after each UI-impacting lot. Most lots are API-only, so UAT happens only at Lot N-2 (end-to-end smoke through the façade).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Scoping (this lot, doc-only)**
  - [x] Read MASTER, workflow, subagents rules + BRANCH_TEMPLATE.
  - [x] Create worktree `tmp/feat-flow-runtime-extract` on `feat/flow-runtime-extract` from `origin/main`.
  - [x] Inventory `todo-orchestration.ts` (33 public methods), `queue-manager.ts` (14 public methods + JobType union), `todo-runtime.ts` (pure helpers), `gate-service.ts`, `default-workflows.ts`, `default-agents.ts`, schema tables.
  - [x] Capture façade design + slice extraction order in `spec/SPEC_EVOL_BR26_FLOW_FACADE.md`.
  - [x] List the 6 golden trace fixtures to capture in Lot 1.
  - [x] Define exception placeholders `BR26-EX1..4`.
  - [x] No code touch.

- [x] **Lot 1 — Golden traces capture (test fixtures only)**
  - [x] Add fixture loader under `api/tests/fixtures/golden/br26/` (path scaffolding only).
  - [x] Capture 6 fixtures (chat tool-loop ≥3, fanout/join across 2 orgs, approval-gated pause+resume, queue-retry, resume-after-crash, cancel-mid-loop) → 6 `.jsonl` files with `{input, events[], final_state}`.
  - [x] Replay harness `api/tests/services/flow/replay.spec.ts` that re-runs current production code and asserts byte-identical event stream (modulo timestamps/IDs).
  - [x] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api SCOPE=tests/services/flow/replay.spec.ts ENV=test-feat-flow-runtime-extract`.

- [x] **Lot 2 — Package shell `packages/flow/`**
  - [x] Scaffold `packages/flow/{package.json,tsconfig.json,src/index.ts,README.md,LICENSE}` mirroring `packages/llm-mesh/` shape (name `@sentropic/flow`, `type: module`, `sideEffects: false`, dist build via `tsc`).
  - [x] Register in root npm workspace (lockfile entries added under `packages/*` glob).
  - [x] Empty `src/index.ts` placeholder; port interfaces from §2 of SPEC_EVOL land in Lot 3.
  - [ ] Lot gate: `make build`, `make typecheck`, `make lint` — blocked by `BR26-FB-01` (pre-existing audit gate vuln on baseline); deferred until baseline rebase onto `origin/main`.

- [x] **Lot 3 — Façade layer (delegating adapters in `api/src/services/flow/`)**
  - [x] Add port interfaces in `packages/flow/src/{workflow-store,run-store,job-queue,approval-gate,agent-template,transitions,flow-runtime}.ts`.
  - [x] Add Postgres adapters in `api/src/services/flow/postgres-{workflow-store,run-store,job-queue,approval-gate,agent-template,transitions}.ts` — each method delegates to the existing `todoOrchestrationService` / `queueManager` / `gate-service` functions (no logic moved yet). RunStore + Transitions stub methods that have no public delegate today and throw `pending Lot 6/7/8` to preserve the "no logic moved" Lot 3 invariant.
  - [x] Add `FlowRuntime` composition root in `api/src/services/flow/flow-runtime.ts`.
  - [x] Re-run replay harness from Lot 1 against the façade → must stay byte-identical (17/17 pass).
  - [x] Lot gate: typecheck-api green, replay spec green (17/17). `lint-api` + full `make test-api ENV=test-feat-flow-runtime-extract` deferred to Lot 4 entry (no api consumers re-bound to the façade yet — Lot N-3 owns that under `BR26-EX3`).

- [x] **Lot 4 — Slice 1: `gate-service.ts` → `ApprovalGate` adapter**
  - [x] Move logic from `api/src/services/gate-service.ts` into `api/src/services/flow/postgres-approval-gate.ts`.
  - [x] Re-export thin re-exports in `gate-service.ts` for backward compatibility (deleted at Lot N).
  - [x] Regression test name: `gate-service.flow-replay.spec.ts` against fixture #3 (approval-gated pause+resume) — covered by the existing `replay.spec.ts` (17/17 green, fixture #3 `approval-gated-pause-resume`).
  - [x] Lot gate: typecheck-api, lint-api, scoped api test, replay harness.

- [ ] **Lot 5 — Slice 2: `default-workflows.ts` → seed catalog port; agent catalog deferred**
  - [x] Move the workflow seed catalog into `packages/flow/src/seeds/workflows.ts` (pure data, no DB access). `api/src/config/default-workflows.ts` reduced to a thin re-export.
  - [!] Move the agent seed catalog into `packages/flow/src/seeds/agents/` — deferred to BR-27, see `BR26-FB-02`.
  - [ ] `seedAgentsForType` / `seedWorkflowsForType` adapters keep the upsert behavior in `api/src/services/flow/postgres-workflow-store.ts`.
  - [ ] Regression: re-seed an empty test DB → resulting rows byte-identical to current main.
  - [x] Lot gate (partial, workflows-only): typecheck-api green, replay harness 17/17 green at commit `15955902`. Agent move still pending; full Lot gate re-runs when agent seeds land.

- [ ] **Lot 6 — Slice 3: `workflow_run_state` CRUD → `RunStore`**
  - [ ] Move snapshot/merge/version OCC logic from `queue-manager.ts` into `packages/flow/src/run-store.ts` + Postgres adapter.
  - [ ] Preserve invariant §4.6 (checkpoint monotonicity).
  - [ ] Regression: fixture #5 (resume-after-crash) + #6 (cancel-mid-loop).
  - [ ] Lot gate: typecheck-api, lint-api, scoped api test, replay harness fixtures #4 + #5 + #6.

- [ ] **Lot 7 — Slice 4: `JobQueue` extraction (lease, DLQ, heartbeat, idempotency)**
  - [ ] Move queue lease/dispatch/cancel/drain methods from `queue-manager.ts` into `packages/flow/src/job-queue.ts` + Postgres adapter.
  - [ ] Preserve invariants §4.2 (job idempotency), §4.7 (tenant scoping), §4.8 (DLQ semantics).
  - [ ] Regression: all 6 fixtures.
  - [ ] Lot gate: typecheck-api, lint-api, full `make test-api`.

- [ ] **Lot 8 — Slice 5: `todo-orchestration.ts` orchestration loop → `FlowRuntime`**
  - [ ] Move the workflow start + transition evaluation + agent resolution logic into `packages/flow/src/flow-runtime.ts` + Postgres adapter composition.
  - [ ] `api/src/services/todo-orchestration.ts` becomes a thin re-export of the façade only.
  - [ ] Regression: all 6 fixtures.
  - [ ] Lot gate: typecheck-api, lint-api, full `make test-api`.

- [ ] **Lot N-3 — Consumer rebinding (`BR26-EX3`)**
  - [ ] Update `chat-service.ts` queueManager call sites to import from the façade.
  - [ ] Update routes (`agent-config.ts`, `plans.ts`, `runs.ts`, `tasks.ts`, `todos.ts`, `workflow-config.ts`, `workspaces.ts`, `initiatives.ts`) to import `flowRuntime` instead of `todoOrchestrationService`.

- [ ] **Lot N-2 — UAT (web app smoke)**
  - [ ] Run one full use-case generation through the façade (matrix prepare → list → detail → exec summary).
  - [ ] Run one approval-gated qualification workflow with manual gate signal.
  - [ ] Run one chat-driven todo creation + task start.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Fold `spec/SPEC_EVOL_BR26_FLOW_FACADE.md` content into `spec/SPEC_VOL_FLOW.md` + updates to `spec/SPEC_WORKFLOW_RUNTIME.md` + `spec/SPEC_AGENTIC_MODEL.md`.
  - [ ] Delete `spec/SPEC_EVOL_BR26_FLOW_FACADE.md`.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api`, `make typecheck`, `make lint-api`, `make lint`.
  - [ ] `make build-api build-ui-image`.
  - [ ] `make test-api ENV=test-feat-flow-runtime-extract`.
  - [ ] `make test-ui ENV=test` (UI must remain untouched; regression check only).
  - [ ] `make clean test-e2e API_PORT=9130 UI_PORT=5330 MAILDEV_UI_PORT=1230 ENV=e2e-feat-flow-runtime-extract E2E_GROUP=<matrix>`.
  - [ ] Final gate step 1: open PR with this `BRANCH.md` as body.
  - [ ] Final gate step 2: CI green on PR.
  - [ ] Final gate step 3: commit removal of `BRANCH.md`, push, merge.
