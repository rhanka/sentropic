# SPEC_EVOL — BR-26 Flow Runtime Façade Extraction

Branch: `feat/flow-runtime-extract` (BR-26).
Mode: SCOPING ONLY (Lot 0). No code touched yet.
References:
- `spec/SPEC_VOL_FLOW.md` (intention)
- `spec/SPEC_WORKFLOW_RUNTIME.md` (current runtime contract)
- `spec/SPEC_AGENTIC_MODEL.md` (agent definition + selection)
- `spec/SPEC_TEMPLATING.md` (placeholder language)
- `feat-multi-agent-framework-comparison/spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §1, §5, §11, §14
- `feat-multi-agent-framework-comparison/spec/SPEC_STUDY_AGENT_AUTONOMY_INCREMENTS.md` §4, §5, §6

This evol spec is folded back into `SPEC_VOL_FLOW.md` + `SPEC_WORKFLOW_RUNTIME.md` + `SPEC_AGENTIC_MODEL.md` at Lot N-1 and then deleted.

## 1. Inventory existant (verbatim from code reading)

### 1.1 `api/src/services/todo-orchestration.ts` (2717 lines)

`TodoOrchestrationService` class exposes **33 public async methods** (singleton instance: `todoOrchestrationService`). Grouped by domain:

- Plan CRUD (3): `createPlan(actor, input)`, `patchPlan(actor, planId, input)`, `getSessionTodoRuntime(actor, sessionId)`.
- Todo CRUD (5): `createTodo(actor, input)`, `patchTodo(actor, todoId, input)`, `assignTodo(actor, todoId, ownerUserId)`, `createTodoFromChat(actor, input)`, `updateTodoFromChat(actor, input)`.
- Task CRUD + lifecycle (6): `createTask(actor, todoId, input)`, `patchTask(actor, taskId, input)`, `assignTask(actor, taskId, assigneeUserId)`, `startTask(actor, taskId, input)`, `completeTask(actor, taskId, input)`, `updateTaskFromChat(actor, input)`.
- Run lifecycle (2): `pauseRun(actor, runId)`, `resumeRun(actor, runId)`.
- Agent config CRUD (5): `listAgentConfigs(actor)`, `putAgentConfigs(actor, items)`, `forkAgentConfig(actor, id, input)`, `detachAgentConfig(actor, id)`, `resetAgentConfig(actor, id)`, `deleteAgentConfig(actor, id)`.
- Workflow config CRUD (5): `listWorkflowConfigs(actor)`, `putWorkflowConfigs(actor, items)`, `forkWorkflowConfig(actor, id, input)`, `detachWorkflowConfig(actor, id)`, `resetWorkflowConfig(actor, id)`, `deleteWorkflowConfig(actor, id)`.
- Seeding (2): `seedAgentsForType(workspaceId, type)`, `seedWorkflowsForType(workspaceId, type)`.
- Workflow start (3): `startWorkflow(...)`, `startInitiativeGenerationWorkflow(...)`, `startAndDispatchInitiativeGenerationWorkflow(...)`.

Transitions semantics live in private helpers `computeTaskStatusPath`, `derivePlanStatus`, `deriveTodoStatus`, `appendExecutionEvent`, `ensureWorkflowDefinition`, `resolveWorkflowTasksWithAgents`, `buildAgentMap`.

### 1.2 `api/src/services/queue-manager.ts` (4516 lines)

`QueueManager` class (singleton `queueManager`) exposes **14 public methods**:
- Lifecycle: `pause()`, `resume()`, `reloadSettings()`.
- Job admission: `addJob(type, data, options)`.
- Job execution: `processJobs()` (main loop), `dispatchWorkflowEntryTasks(params)`.
- Cancellation: `cancelJob(jobId, reason)`, `cancelAllProcessing(reason)`, `cancelProcessingForWorkspace(workspaceId, reason)`, `drain(timeoutMs)`.
- Inspection: `getJobStatus(jobId, opts)`, `getAllJobs(opts)`, `findLatestDocxJobBySource(params)`, `invalidateDocxCacheForEntity(params)`.

`JobType` union (10 variants): `'organization_enrich' | 'organization_batch_create' | 'organization_targets_join' | 'matrix_generate' | 'initiative_list' | 'initiative_detail' | 'executive_summary' | 'chat_message' | 'document_summary' | 'docx_generate'`.

Per-`JobType` JobData interfaces (each tied to a workflow task executor): `OrganizationEnrichJobData`, `OrganizationBatchCreateJobData`, `OrganizationTargetsJoinJobData`, `MatrixGenerateJobData`, `InitiativeListJobData`, `InitiativeDetailJobData`, `ExecutiveSummaryJobData`, `ChatMessageJobData`, `DocumentSummaryJobData`, `DocxGenerateJobData`.

Private helpers driving the workflow loop: `mergeWorkflowRunState` (strict OCC with retry-on-version-conflict, up to 5 attempts), `upsertWorkflowTaskResult`, `markWorkflowTaskStarted`, `completeWorkflowTask`, `failWorkflowTask`, `evaluateWorkflowCondition` (operators `eq`, `not_empty`, `all`, `any`, `not`), `resolveWorkflowBindingValue`, `getWorkflowTaskInstanceKey`, `getJobAttempt`, `markExecutionRunStatus`, `getWorkflowRunStateSnapshot`. Postgres `NOTIFY` channels: `job_events`, `organization_events`, `folder_events`, `initiative_events`, `comment_events`.

### 1.3 `api/src/services/todo-runtime.ts` (281 lines)

Pure helper module (no DB access). Exports: `TASK_STATUSES`, `TaskStatus`, `DerivedAggregateStatus`, `isTaskStatus`, `getAllowedTaskStatusTransitions`, `canTransitionTaskStatus`, `assertTaskStatusTransition`, `deriveAggregateStatus`, `TodoPermissionAction`, `TodoPermissionContext`, `canPerformTodoAction`, `GUARDRAIL_CATEGORIES`, `GuardrailCategory`, `GuardrailDecision`, `GuardrailEvaluationInput`, `classifyGuardrailDecision`, `EXECUTION_RUN_MODES`, `ExecutionRunMode`, `EXECUTION_RUN_STATUSES`, `ExecutionRunStatus`, `ExecutionEventDraft`, `ExecutionEventRecord`, `getNextExecutionEventSequence`, `appendExecutionEvent`, `listExecutionEventsForRun`, `extractPlaceholdersFromText`, `extractWorkflowSectionPlaceholders`, `extractWorkflowPlaceholdersBySection`.

This file is **already pure** and is the easiest to lift into `packages/flow/src/runtime-helpers.ts` (zero adapter needed).

### 1.4 `api/src/services/gate-service.ts` (252 lines)

Exports: `GateMode`, `GateCriteria`, `GateConfig`, `GateEvaluationResult`, `getDefaultGateConfig(type)`, `resolveGateConfig(workspaceId)`, `evaluateGate(workspaceId, initiativeId, targetStage)`. Reads `workspaces.gate_config` JSONB; queries `guardrails` for category violations; reads `initiatives.data` for `required_fields` checks. Per-stage criteria for `opportunity` workspace type (`G2`, `G5`, `G7`).

### 1.5 `api/src/config/default-workflows.ts` (858 lines)

Exports: `USE_CASE_GENERATION_WORKFLOW_KEY`, `DefaultWorkflowTaskDefinition`, `DefaultWorkflowTransitionDefinition`, `DefaultWorkflowDefinition`, `WorkspaceTypeWorkflowSeed`, `DEFAULT_USE_CASE_GENERATION_WORKFLOW`, `OPPORTUNITY_IDENTIFICATION_WORKFLOW`, `OPPORTUNITY_QUALIFICATION_WORKFLOW`, `CODE_ANALYSIS_WORKFLOW`, `WORKSPACE_TYPE_WORKFLOW_SEEDS`, `getWorkflowSeedsForType(type)`. Pure data. Task metadata carries `executor: 'job' | 'noop'`, optional `jobType`, optional `inputBindings`, optional `agentSelection`.

### 1.6 `api/src/config/default-agents.ts` (69 lines, hub)

Aggregates `AI_IDEAS_AGENTS`, `OPPORTUNITY_AGENTS`, `CODE_AGENTS`, `SHARED_AGENTS` from sibling files. Exports `WORKSPACE_TYPE_AGENT_SEEDS`, `getAgentSeedsForType(type)`, `DEFAULT_GENERATION_AGENT_BY_KEY`, `DEFAULT_GENERATION_AGENT_KEY_BY_TASK` (legacy). `DefaultGenerationAgentDefinition` carries `key`, `name`, `config` JSON with `promptTemplate` (string template), `defaultTools`, `modelPrefs`.

### 1.7 Tables (`api/src/db/schema.ts`)

- `agent_definitions` (id, workspace_id, key UNIQUE per workspace, config jsonb, source_level, lineage_root_id, parent_id, is_detached) — line 703.
- `workflow_definitions` (id, workspace_id, key UNIQUE per workspace, config jsonb, source_level, lineage_root_id, parent_id, is_detached) — line 731.
- `workflow_definition_tasks` (id, workflow_definition_id, task_key, order_index, agent_definition_id FK, input_schema jsonb, output_schema jsonb, section_key, metadata jsonb) — line 759.
- `workflow_task_transitions` (id, workflow_definition_id, from_task_key, to_task_key, transition_type, condition jsonb, metadata jsonb) — line 785.
- `guardrails` (id, workspace_id, entity_type, entity_id, category, instruction, config jsonb, is_active) — line 807.
- `execution_runs` (id, workspace_id, plan_id?, todo_id?, task_id?, workflow_definition_id?, agent_definition_id?, mode, status, started_by_user_id, started_at, completed_at, metadata) — line 849.
- `execution_events` (id, workspace_id, run_id, event_type, actor_type?, actor_id?, payload, sequence UNIQUE per run) — line 873.
- `workflow_run_state` (run_id PK, workspace_id, workflow_definition_id?, status, state jsonb, version int [OCC], current_task_key?, current_task_instance_key?, checkpointed_at) — line 894.
- `workflow_task_results` (PK = run_id+task_key+task_instance_key, status, input_payload, output, state_patch, attempts, last_error) — line 917.
- `workspace_type_workflows` (id, workspace_type, workflow_definition_id FK, is_default, trigger_stage?) — line 1026.
- `job_queue` (line 114, existing; QueueManager owns it).

## 2. Public boundary to expose in `@sentropic/flow`

Port interfaces (declared in `packages/flow/src/`, instantiated as Postgres adapters in `api/src/services/flow/`):

- `WorkflowStore` (definitions catalog).
  - Methods: `getById(id)`, `getByWorkspaceKey(workspaceId, key)`, `listByWorkspace(workspaceId)`, `upsertMany(workspaceId, items)`, `fork(id, input)`, `detach(id)`, `reset(id)`, `delete(id)`, `listWorkspaceTypeWorkflows(type)`, `seedForWorkspaceType(workspaceId, type)`.
  - Proxies: all `*WorkflowConfig*` + `seedWorkflowsForType` methods of `TodoOrchestrationService`.

- `RunStore` (workflow_run_state + workflow_task_results CRUD + OCC).
  - Methods: `getSnapshot(runId)`, `mergeState(params)`, `upsertTaskResult(params)`, `markTaskStarted(params)`, `completeTask(params)`, `failTask(params)`, `markRunStatus(runId, status)`.
  - Proxies: private helpers of `QueueManager` (`getWorkflowRunStateSnapshot`, `mergeWorkflowRunState`, `upsertWorkflowTaskResult`, `markWorkflowTaskStarted`, `completeWorkflowTask`, `failWorkflowTask`, `markExecutionRunStatus`).

- `JobQueue` (lease/heartbeat/DLQ/idempotency).
  - Methods: `enqueue(type, data, options)`, `processLoop()` (long-running), `cancelJob(id, reason)`, `cancelByWorkspace(workspaceId, reason)`, `cancelAll(reason)`, `drain(timeoutMs)`, `getJobStatus(id)`, `listJobs(opts)`, `pause()`, `resume()`, `reloadSettings()`, `dispatchWorkflowEntryTasks(params)`.
  - Proxies: corresponding `QueueManager` public methods.

- `ApprovalGate` (gate evaluation + signal).
  - Methods: `resolveConfig(workspaceId)`, `getDefaultConfig(type)`, `evaluate(workspaceId, entityId, targetStage)`, `signal(runId, decision)` *(new — currently inlined inside `resumeRun`)*.
  - Proxies: `resolveGateConfig`, `getDefaultGateConfig`, `evaluateGate`. The `signal` operation is a Lot 8 refactor that re-uses `resumeRun` semantics under a dedicated gate-aware path.

- `AgentTemplate` (resolve agent config with templating).
  - Methods: `getById(agentDefinitionId)`, `getByWorkspaceKey(workspaceId, key)`, `listByWorkspace(workspaceId)`, `upsertMany(workspaceId, items)`, `fork(id, input)`, `detach(id)`, `reset(id)`, `delete(id)`, `seedForWorkspaceType(workspaceId, type)`, `resolve(agentId, contextVars, attachedSkills?)` returning `ResolvedAgentConfig { systemPrompt, tools[], modelPrefs }`.
  - Proxies: all `*AgentConfig*` + `seedAgentsForType` methods, plus `resolveWorkflowTasksWithAgents` + `buildAgentMap` for the `resolve()` step. Implements SPEC_STUDY_ARCHITECTURE_BOUNDARIES §14 invariant.

- `Transitions` (evaluate workflow condition; pick next task).
  - Methods: `evaluateCondition(condition, state)`, `resolveBindingValue(binding, ctx)`, `computeNextTask(definition, currentTaskKey, state)`, `assertStatusTransition(from, to)` *(delegated from `todo-runtime`)*.
  - Proxies: `QueueManager.evaluateWorkflowCondition`, `resolveWorkflowBindingValue`, `getPathValue`; plus `todo-runtime.assertTaskStatusTransition`.

- `FlowRuntime` (high-level orchestrator composing all of the above).
  - Methods: `startWorkflow(params)`, `startInitiativeGenerationWorkflow(params)`, `startAndDispatch(params)`, `pauseRun(actor, runId)`, `resumeRun(actor, runId)`, `getSessionRuntime(actor, sessionId)`.
  - Proxies: corresponding `TodoOrchestrationService` methods. Holds references to all ports above via constructor injection.

Plus pure helpers moved verbatim from `api/src/services/todo-runtime.ts` into `packages/flow/src/runtime-helpers.ts`: task status FSM, guardrail classifier, execution-event sequencing, placeholder extraction.

## 3. Façade design (Lot 3)

Mirrors the BR-14b chat-core shell pattern (`packages/llm-mesh/` shape: scoped npm name `@sentropic/flow`, `type: module`, `sideEffects: false`, ESM-only, `tsc` build).

Layout:

```
packages/flow/
  package.json                 # name @sentropic/flow, exports ./dist/index.js
  tsconfig.json
  src/
    index.ts                   # re-exports ports + types
    runtime-helpers.ts         # pure functions from todo-runtime.ts
    workflow-store.ts          # interface only
    run-store.ts               # interface only
    job-queue.ts               # interface only
    approval-gate.ts           # interface only
    agent-template.ts          # interface only
    transitions.ts             # interface only
    flow-runtime.ts            # composition interface + types
    seeds/                     # (Lot 5) default-workflows + default-agents data

api/src/services/flow/        # Postgres adapter layer (lives in app, not in package)
  postgres-workflow-store.ts
  postgres-run-store.ts
  postgres-job-queue.ts
  postgres-approval-gate.ts
  postgres-agent-template.ts
  postgres-transitions.ts
  flow-runtime.ts              # composition root, exports flowRuntime singleton
  index.ts                     # re-exports flowRuntime for app consumers
```

Lot 3 contract:
- Each Postgres adapter implements its interface by **delegating method-by-method to the existing `todoOrchestrationService` / `queueManager` / `gate-service` exports**. No logic is moved, no semantics change.
- `api/src/services/todo-orchestration.ts` and `queue-manager.ts` public APIs remain unchanged.
- Consumers (`chat-service`, route handlers) keep their current imports during Lot 3. They are rebound to the façade only in Lot N-3 (under `BR26-EX3`).
- Lot 4..8 progressively **move** the implementation body into the adapter; each move leaves a thin re-export in the legacy file (no behavioral change).
- Lot N (post Lot 8) deletes the legacy files; the façade is the only entrypoint.

## 4. Slice extraction order (Lot 4..8)

Order designed to push the largest/most-risk surface to the end:

| Lot | Slice                                              | Files moved                                    | Regression fixtures        |
|-----|----------------------------------------------------|------------------------------------------------|----------------------------|
| 4   | `gate-service.ts` → `ApprovalGate`                 | `gate-service.ts` (252 lines)                  | #3 (approval-gated)        |
| 5   | `default-workflows.ts` + `default-agents.ts` seeds | both config files (858 + 69 lines)             | #1, #2                     |
| 6   | `workflow_run_state` CRUD → `RunStore`             | OCC helpers in `queue-manager.ts` (~400 lines) | #4, #5, #6                 |
| 7   | `JobQueue` (lease, DLQ, heartbeat, idempotency)    | bulk of `queue-manager.ts` (~3500 lines)       | all 6                      |
| 8   | `todo-orchestration.ts` orchestration loop         | `todo-orchestration.ts` (2717 lines)           | all 6                      |

Each slice: golden trace replay must produce byte-identical event stream (modulo timestamps/IDs); `chat-service.ts` requires no change before Lot N-3.

## 5. Golden traces (mandatory Lot 1, before any Lot 4 move)

Path: `api/tests/fixtures/golden/br26/`.

| # | Filename                                  | Scenario                                          |
|---|-------------------------------------------|---------------------------------------------------|
| 1 | `chat-tool-loop-3steps.jsonl`             | One full chat session, tool loop length ≥ 3       |
| 2 | `fanout-join-2-orgs.jsonl`                | One `fanout/join` workflow across ≥ 2 organizations |
| 3 | `approval-gate-pause-resume.jsonl`        | Approval-gated workflow with `gate-service` pause + resume |
| 4 | `queue-retry-once.jsonl`                  | Job retried at least once via the Postgres queue  |
| 5 | `resume-after-crash.jsonl`                | Resume after simulated worker crash mid-task      |
| 6 | `cancel-mid-tool-loop.jsonl`              | Cancellation mid-tool-loop with partial output    |

Each fixture line: `{ts, runId, taskKey, eventType, payload, sequence}`. Each file ends with a `final_state` envelope: `{runId, status, workflowRunState, taskResults[]}`.

Replay harness `api/tests/services/flow/replay.spec.ts` asserts equality after normalizing `id`/`ts` fields. Re-run after each Lot 4..8.

## 6. Agent templating invariant

`AgentTemplate.resolve(agentId, contextVars, attachedSkills?)` is the single boundary point for: (i) rendering `promptTemplate` with `{{placeholder}}`, (ii) applying `agentSelection` rules (`defaultAgentKey` + conditional `rules[]`), (iii) overlaying skill-supplied instructions/tools. This MUST survive extraction without semantic drift — same `agentId + state` must yield the same `ResolvedAgentConfig` before and after each slice. Validated via the agent-touching fixtures (#1, #2, #3). Reference SPEC_STUDY_ARCHITECTURE_BOUNDARIES §14.

## 7. Risks

- **`queue-manager.ts` size (4516 lines).** Pushed to Lot 7 so all easier slices land first. The OCC-with-retry helpers (Lot 6) are split out first to shrink the surface.
- **Transactional boundaries inside `todo-orchestration.ts` are not visible from public methods.** Façade Lot 3 must preserve them; we rely on the existing `db.transaction(...)` blocks staying in the same file until Lot 8. Replay harness will catch ordering drift.
- **Agent template resolution is interleaved with workflow execution.** `resolveWorkflowTasksWithAgents` + `buildAgentMap` are private and currently called from `startWorkflow`. Lot 8 must expose them via the `AgentTemplate` port without changing call sequence.
- **`NOTIFY` channels` in `queue-manager.ts` couple the queue to Postgres LISTEN/NOTIFY for SSE.** The port abstraction must keep a Postgres-only adapter for now; an in-memory adapter (per SPEC_STUDY §5) is deferred to a post-BR26 spike.
- **`chat-service.ts` consumer is in `Forbidden Paths`.** Lot N-3 is the only opportunity to rebind it (under `BR26-EX3`). If chat-service tests fail before then, the issue is regression in the façade, not chat-service.
- **Workspaces of type `neutral`** have no agents/workflows — fixtures must avoid neutral workspace coverage to keep regressions deterministic.

## 8. Open questions (to close in Lot 1+)

1. `BR26-Q1`: should `gate-service.signal(runId, decision)` be a new public method (moved out of inline `resumeRun`) at Lot 4, or kept inline until Lot 8? **Lean: extract at Lot 4** to lock the boundary early.
2. `BR26-Q2`: does the `AgentTemplate.resolve()` step need to accept the workspace `AuthzContext` even though skills/marketplace aren't in scope here? **Lean: yes**, accept an optional `authz` param even if it is unused by Postgres adapter, to avoid breaking the contract once `@sentropic/skills` lands.
3. `BR26-Q3`: should we ship an in-memory adapter for `RunStore` and `JobQueue` in `packages/flow` for tests, or defer to a follow-up branch? **Lean: defer**; the Postgres adapter alone covers BR-26's regression goal.
4. `BR26-Q4`: are `executionEvents.sequence` and `workflow_run_state.version` enough to certify byte-identical replay, or do we also need `workflow_task_results.attempts`? **Lean: include all three** in the equality check; document in the replay harness.
5. `BR26-Q5`: does `default-workflows.ts` need to stay in `api/src/config/` as a thin re-export after Lot 5, or can routes import from `packages/flow/seeds` directly? **Lean: thin re-export until Lot N-3** to keep app imports stable.
6. `BR26-Q6`: do we need a migration for the new `chat-service` call sites (Lot N-3) to register the façade `flowRuntime` singleton in the app bootstrap, or is module-level instantiation enough (mirroring `queueManager`)? **Lean: module-level**, identical to current pattern.
7. `BR26-Q7`: does the package need to expose its Zod schemas (input/output validation for tasks) at the boundary, or do we keep them in `api/`? **Lean: deferred to BR-27**; BR-26 is a behavior-preserving extraction only.
