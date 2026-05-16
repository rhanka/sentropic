# Branch Plan Stub: BR-26 Flow Runtime Extract

Current coordination source:

- `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§1 cartography, §11 delivery cadence, §14 agent templating invariant)
- `spec/SPEC_VOL_FLOW.md` (to be authored in BR-23 PR #148 scope)

Branch:

- BR-26 `feat/flow-runtime-extract`
- Worktree (when launched): `tmp/feat-flow-runtime-extract`

Ordering rule:

- BR-26 runs after BR-14b (`@sentropic/contracts` + `@sentropic/events` + `@sentropic/chat-core`) merges, since `@sentropic/flow` consumes the same transverse contracts and the `CheckpointStore<T>` port lives in contracts.
- BR-26 must run before BR-30 (`feat/external-triggers`), which folds new trigger sources on top of the extracted flow runtime.

Scope summary:

- Extract `@sentropic/flow` from `api/src/services/todo-orchestration.ts` + `api/src/services/queue-manager.ts` + `api/src/config/default-workflows.ts` via the façade-first pattern (no rewrite of the DAG engine).
- Owns `CheckpointStore<FlowState>` instance with the **strict OCC strategy** adapter (§12).
- Owns the `JobQueue` port (bridge to background tasks, §10.4).
- Preserves the **agent templating invariant** documented in §14 (`promptTemplate`, `agentSelection`, runtime `resolve()` of agent + skills overlay).
- Does NOT define provider/model access — all model calls continue to flow through `@sentropic/llm-mesh`; chat steps flow through `@sentropic/chat-core`.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Inventory `todo-orchestration.ts`, `queue-manager.ts`, `default-workflows.ts`, and all flow/agent E2E tests.
- Confirm `@sentropic/contracts` + `@sentropic/events` are frozen on `main` before scaffolding the package.
