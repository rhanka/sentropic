# SPEC_VOL — @sentropic/flow

`@sentropic/flow` is the reusable workflow runtime package extracted from the
Sentropic API runtime. It owns workflow definitions, run state helpers, queue
contracts, transition evaluation, approval-gate boundaries, and default workflow
seed data while keeping app-specific persistence in API adapters.

## Purpose

The package exists to make long-running agentic workflows reusable outside the
Sentropic web app without rewriting the existing DAG engine. BR-26/BR-32 uses a
façade-first extraction: public app behavior stays stable while logic moves from
`api/src/services/queue-manager.ts`, `api/src/services/gate-service.ts`, and
`api/src/config/default-workflows.ts` into typed package modules and Postgres
adapters.

The runtime preserves these invariants:

- Workflow transition semantics stay compatible with existing
  `workflow_run_state` and `workflow_task_results` rows.
- Job queue semantics preserve lease, heartbeat, retry, cancellation,
  idempotency, and DLQ behavior.
- Agent templating remains part of workflow execution through
  `promptTemplate`, `agentSelection`, and runtime agent resolution.
- Provider and model calls remain outside this package and continue through
  `@sentropic/llm-mesh`.
- Chat-session orchestration remains outside this package and continues through
  chat-core/API services.

## Public Boundary

`packages/flow/src/index.ts` exports package-owned runtime types and helpers:

- `WorkflowStore` for workflow definition catalog operations.
- `RunStore` for workflow state snapshots, OCC state merge, task result writes,
  and execution-run status updates.
- `JobQueue` for job admission, processing, queue controls, cancellation,
  draining, inspection, and workflow-entry dispatch.
- `ApprovalGate` for gate config resolution and gate evaluation.
- `AgentTemplate` for agent catalog access and template resolution boundaries.
- `Transitions` and pure helpers for condition evaluation, binding resolution,
  task instance keys, and workflow dispatch.
- `FlowRuntime` helpers for generic workflow start and initiative-generation
  start metadata/state construction.
- Default workflow seeds under `packages/flow/src/seeds/workflows.ts`.

The API app owns concrete Postgres adapters under `api/src/services/flow/**`.
Those adapters bind package contracts to the existing database schema, job
queue tables, workflow tables, and Sentropic services.

## Runtime Architecture

The current app composition root is `api/src/services/flow/flow-runtime.ts`.
It creates an `AppFlowRuntime` with Postgres implementations of the package
ports. Start paths for generic workflows and initiative generation now create
run metadata/state through the flow runtime and dispatch workflow entry tasks
through the `JobQueue` port.

The queue runtime has been decomposed into package modules:

- `job-queue-controls.ts` for pause, resume, and queue settings reload.
- `processing-loop.ts` for the outer queue-processing loop.
- `job-runner.ts` for executor dispatch, retry classification, abort handling,
  and terminal-failure hooks.
- `dispatch.ts` for workflow transition dispatch, fanout/join readiness,
  task reservation, task lifecycle completion, and agent selection during
  dispatch.
- `condition-eval.ts` for condition and binding helpers.
- `run-store.ts`, `job-queue.ts`, `workflow-store.ts`, and related files for
  package contracts.

Legacy API service files remain as compatibility entrypoints where required by
existing consumers, but the behavior they expose is now backed by package
helpers and adapters for the extracted slices.

## Persistence

`@sentropic/flow` does not talk to Postgres directly. Persistence lives in API
adapters:

- `PostgresWorkflowStore`
- `PostgresRunStore`
- `PostgresJobQueue`
- `PostgresApprovalGate`
- `PostgresAgentTemplate`
- `PostgresTransitions`

This keeps package code reusable and keeps tenant scoping, DB transactions,
LISTEN/NOTIFY, and app-specific side effects inside the API boundary.

## Validation Strategy

The extraction is guarded by golden workflow fixtures in
`api/tests/fixtures/golden/br26/` and replay tests in
`api/tests/services/flow/replay.spec.ts`. Fixtures cover:

- chat tool loop;
- fanout/join across organizations;
- approval-gated pause/resume;
- queue retry;
- resume after crash;
- cancellation mid-loop.

Replay assertions normalize volatile identifiers/timestamps while preserving
workflow event order, final state, task results, and retry/cancellation
semantics.

## Non-Goals

`@sentropic/flow` does not implement provider/model access, chat UI behavior,
chat-core streaming, marketplace publishing, external triggers, or a new
Temporal/LangGraph-style engine. It extracts and stabilizes the existing
Sentropic flow runtime behind package contracts.

## Follow-Ups

The following items are intentionally outside the completed extraction branch:

- Move the full agent seed catalog into a package-owned data boundary. The
  current catalog imports prompt fragments and remains API-owned until a
  dedicated prompt/catalog extraction branch.
- Convert every legacy `todoOrchestrationService` consumer to `flowRuntime`.
  Existing compatibility entrypoints remain available while the package
  boundary is adopted incrementally.
- Add in-memory adapters for package-level tests. BR-26/BR-32 validates the
  production Postgres adapter path.
