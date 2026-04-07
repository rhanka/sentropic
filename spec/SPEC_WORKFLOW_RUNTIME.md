# Workflow Runtime Specification

## 1. Workflow Definition Structure

A workflow is defined by `DefaultWorkflowDefinition` in `api/src/config/default-workflows.ts`:

```ts
{
  key: string;           // Unique identifier (e.g. "ai_usecase_generation_v1")
  name: string;          // Human-readable name
  description: string;   // Purpose description
  config: Record;        // Metadata (route, domain, migration info)
  tasks: DefaultWorkflowTaskDefinition[];
  transitions: DefaultWorkflowTransitionDefinition[];
}
```

### Task Definition

Each task declares:

- `taskKey` — unique string identifier within the workflow
- `title`, `description` — human-readable labels
- `orderIndex` — ordering for display and sequential resolution
- `agentKey` — optional reference to an agent definition (null for infrastructure tasks)
- `metadata` — execution configuration containing:
  - `executor` — `"job"` (enqueue to PostgreSQL queue) or `"noop"` (complete immediately)
  - `jobType` — when executor is `"job"`, maps to a `JobType` (e.g. `"initiative_list"`, `"organization_enrich"`)
  - `inputBindings` — binding expressions resolved at runtime (see section 7)
  - `agentSelection` — optional conditional agent routing (see section 5)

### Task-Key Naming Convention

Both `ai_usecase_generation_v1` and `opportunity_identification` workflows share structural roles with domain-specific prefixes:

| Role | ai-ideas | opportunity |
|------|----------|-------------|
| context_prepare | generation_context_prepare | context_prepare |
| matrix_prepare | generation_matrix_prepare | matrix_prepare |
| create_organizations | generation_create_organizations | create_organizations |
| organization_enrich | generation_organization_enrich | organization_enrich |
| organization_join | generation_organization_join | organization_targets_join |
| list | generation_usecase_list | opportunity_list |
| todo_sync | generation_todo_sync | todo_sync |
| detail | generation_usecase_detail | opportunity_detail |
| executive_summary | generation_executive_summary | executive_summary |

Task keys are not renamed to avoid breaking existing DB `workflow_run_state` rows.

## 2. Transition Types

Transitions are defined by `DefaultWorkflowTransitionDefinition`:

```ts
{
  fromTaskKey: string | null;   // null = workflow entry point
  toTaskKey: string | null;     // null = workflow exit point
  transitionType: "start" | "normal" | "conditional" | "fanout" | "join" | "end";
  condition?: Record;           // Evaluated against workflow state
  metadata?: Record;            // Fanout/join configuration
}
```

### Transition Types

- **start** — `fromTaskKey: null`, entry point of the workflow. Dispatched by `dispatchWorkflowEntryTasks`.
- **normal** — unconditional transition from one task to the next. Always fires if no higher-priority conditional matches.
- **conditional** — fires only when `condition` evaluates to true against current workflow state.
- **fanout** — iterates over an array in state and dispatches one task instance per item (see section 4).
- **join** — waits for all instances of a fanned-out task (or a set of required tasks) to complete before proceeding (see section 4).
- **end** — `toTaskKey: null`, marks workflow as completed. Sets run status to `completed` and marks execution run as completed.

### Condition System

Conditions are evaluated by `evaluateWorkflowCondition()` against the workflow state object:

**Leaf conditions:**
- `conditionEq(path, value)` — `{ path, operator: "eq", value }` — state value at path equals value
- `conditionNotEmpty(path)` — `{ path, operator: "not_empty" }` — array has length > 0, string is non-empty, or value is truthy

**Logical combinators:**
- `allOf(...conditions)` — `{ all: [...] }` — all sub-conditions must be true (AND)
- `anyOf(...conditions)` — `{ any: [...] }` — at least one sub-condition must be true (OR)
- `notOf(condition)` — `{ not: condition }` — inverts the sub-condition (NOT)

**Supported operators:** `eq`, `truthy`, `not_empty`.

Path resolution uses dot-notation against the workflow state (e.g. `inputs.autoCreateOrganizations`, `orgContext.effectiveOrgIds`).

## 3. Database Schema

### workflow_run_state

Primary state table for active workflow runs. One row per execution run.

| Column | Type | Description |
|--------|------|-------------|
| runId | text (PK) | FK to execution_runs.id |
| workspaceId | text | FK to workspaces.id |
| workflowDefinitionId | text | FK to workflow_definitions.id |
| status | text | `pending`, `in_progress`, `completed`, `failed` |
| state | jsonb | Full workflow state object (inputs, orgContext, generation sections) |
| version | integer | Optimistic concurrency version (incremented on each state patch) |
| currentTaskKey | text | Currently executing task key |
| currentTaskInstanceKey | text | Instance key for fanout tasks (or `main`) |
| checkpointedAt | timestamp | Last state write timestamp |

### workflow_task_results

Per-task execution record. Composite PK: (runId, taskKey, taskInstanceKey).

| Column | Type | Description |
|--------|------|-------------|
| runId | text | FK to execution_runs.id |
| workspaceId | text | FK to workspaces.id |
| workflowDefinitionId | text | FK to workflow_definitions.id |
| taskKey | text | Task identifier from workflow definition |
| taskInstanceKey | text | `main` for singleton tasks, or item-specific key for fanout |
| status | text | `pending`, `in_progress`, `completed`, `failed` |
| inputPayload | jsonb | Resolved input bindings at dispatch time |
| output | jsonb | Task output data |
| statePatch | jsonb | State modifications to merge into workflow_run_state.state |
| attempts | integer | Number of execution attempts (for retry) |
| lastError | jsonb | Error details on failure |

### workflow_task_transitions

Persisted transition definitions per workflow definition. Loaded at runtime by `loadWorkflowRuntimeDefinition`.

| Column | Type | Description |
|--------|------|-------------|
| id | text (PK) | Transition ID |
| workspaceId | text | FK to workspaces.id |
| workflowDefinitionId | text | FK to workflow_definitions.id |
| fromTaskKey | text | Source task (null for start) |
| toTaskKey | text | Target task (null for end) |
| transitionType | text | Transition type string |
| condition | jsonb | Condition expression |
| metadata | jsonb | Fanout/join configuration |

## 4. Fanout/Join Semantics

### Fanout

A fanout transition iterates over an array in the workflow state and dispatches one task instance per item.

Configuration in `transition.metadata.fanout`:
- `sourcePath` — dot-path to an array in the workflow state (e.g. `generation.initiatives`, `orgContext.organizationTargets`)
- `itemKey` — label for the item in binding context (e.g. `initiative`, `organizationTarget`)
- `instanceKeyPath` — optional dot-path within each item to extract a unique instance key (e.g. `organizationId`). Falls back to `item.id`, `item.key`, or `taskKey:index`.

Each dispatched task instance receives the item via `$item` bindings and gets a unique `taskInstanceKey`.

### Join

A join transition waits for all expected task instances to complete before proceeding.

Configuration in `transition.metadata.join`:
- `taskKey` — the fanned-out task key to wait for
- `mode` — `"all"` (wait for all instances) or `"all_main"` (wait for specific main task keys)
- `expectedSourcePath` — dot-path to the same array used in the upstream fanout (for counting expected instances)
- `allowEmpty` — if true, proceed even when the source array is empty
- `requiredTaskKeys` — (for `all_main` mode) explicit list of task keys whose `main` instance must be completed

Join readiness check (`isWorkflowJoinTransitionReady`):
1. If `requiredTaskKeys` is set: check that all listed task keys have a completed `main` instance.
2. Otherwise: match completed instance keys against expected items from `expectedSourcePath` using the same instance key derivation as fanout.

### Dispatch De-duplication

Before dispatching a task, `reserveWorkflowTaskDispatch` uses `INSERT ... ON CONFLICT DO NOTHING` on the (runId, taskKey, taskInstanceKey) composite key. If the insert is skipped (row already exists and is not failed), the dispatch is silently dropped. This prevents double-dispatch in concurrent scenarios.

## 5. Executor Registry

Tasks declare their executor in `metadata.executor`:

- **`noop`** — Task completes immediately with empty output. Used for orchestration waypoints (e.g. `context_prepare`, `todo_sync`). After completing, immediately dispatches downstream transitions.
- **`job`** — Task is enqueued to the PostgreSQL job queue via `addJob()`. Requires `metadata.jobType` mapping to a handler.

### Job Types

| JobType | Handler | Description |
|---------|---------|-------------|
| organization_batch_create | QueueManager.processJob | Batch-create organization targets |
| organization_enrich | QueueManager.processJob | Enrich/create one organization |
| organization_targets_join | QueueManager.processJob | Join organization results |
| matrix_generate | QueueManager.processJob | Generate matrix configuration |
| initiative_list | QueueManager.processJob | Generate initiative list |
| initiative_detail | QueueManager.processJob | Generate one initiative detail |
| executive_summary | QueueManager.processJob | Generate executive summary |
| chat_message | QueueManager.processJob | Process chat message |
| document_summary | QueueManager.processJob | Summarize a document |
| docx_generate | QueueManager.processJob | Generate DOCX document |

### Agent Selection at Runtime

Tasks can declare `agentSelection` in their metadata for conditional agent routing:

```ts
agentSelection: {
  defaultAgentKey: "usecase_list_agent",
  rules: [
    {
      condition: anyOf(
        conditionEq("inputs.autoCreateOrganizations", true),
        conditionNotEmpty("orgContext.effectiveOrgIds"),
      ),
      agentKey: "usecase_list_with_orgs_agent",
    },
  ],
}
```

Resolution order in `resolveWorkflowTaskAgentDefinitionId`:
1. Evaluate each rule's condition against workflow state. First matching rule wins.
2. If no rule matches, use `defaultAgentKey`.
3. If no selection block exists, use the task's static `agentDefinitionId`.

The resolved agent ID determines which prompt override and output schema are used for generation.

## 6. Matrix Barrier Pattern

When both `initiative_list` and `matrix_prepare` must complete before `todo_sync`, a "matrix barrier" join is used. This is a join transition with `mode: "all_main"` and explicit `requiredTaskKeys`:

```ts
matrixBarrierJoinMetadata(["generation_usecase_list", "generation_matrix_prepare"])
// produces:
{ join: { mode: "all_main", requiredTaskKeys: [...] } }
```

Both the `usecase_list -> todo_sync` and `matrix_prepare -> todo_sync` transitions carry the same barrier metadata. The join fires only when both required task keys have a completed `main` instance.

This pattern is used in both `ai_usecase_generation_v1` and `opportunity_identification` workflows when matrix preparation is required (i.e. `matrixSource === "prompt"` or `matrixMode === "generate"` with null matrixSource).

## 7. State Management

### Workflow State Sections

The `workflow_run_state.state` JSONB object contains three primary sections:

- **`inputs`** — Original request parameters: `folderId`, `input`, `model`, `matrixMode`, `matrixSource`, `autoCreateOrganizations`, `initiativeCount`, `locale`, `organizationId`, `initiatedByUserId`
- **`orgContext`** — Organization resolution state: `effectiveOrgIds`, `selectedOrgIds`, `organizationTargets` (array of `{ organizationId, organizationName, skipIfCompleted, wasCreated }`)
- **`generation`** — Generation runtime state: `initiatives` (array of `{ id, name, description, organizationIds, organizationName }`)

### State Patches and Optimistic Concurrency

State updates use `mergeWorkflowRunState` with optimistic concurrency control:
1. Read current state and version.
2. Deep-merge the `statePatch` into existing state.
3. Write with `WHERE version = current_version`.
4. Retry up to 5 times on concurrent update conflicts.

The `deepMergeState` function recursively merges objects (objects are merged key-by-key; non-objects overwrite).

### Input Binding Resolution

Input bindings in task metadata are resolved at dispatch time by `resolveWorkflowBindingValue`:

- `$state.path.to.value` — reads from workflow state
- `$run.field` — reads from execution run context (e.g. `startedByUserId`)
- `$item.field` — reads from the current fanout item
- Literal values pass through unchanged
- Arrays and objects are recursively resolved

### Task Lifecycle

1. **Reserve** — `INSERT ... ON CONFLICT DO NOTHING` creates a `pending` task result row.
2. **Dispatch** — For `job` executor: enqueue to job_queue. For `noop`: complete immediately.
3. **Execute** — Job handler processes the task, producing output and optional state patch.
4. **Complete** — `completeWorkflowTask` records output, merges state patch, then dispatches downstream transitions and checks pending joins.
5. **Fail** — `failWorkflowTask` records error, sets run status to `failed`, marks execution run as failed.

### Retry

On retryable errors (transient/provider failures), the job is re-enqueued with `_retry: { attempt, maxRetries }` metadata. The task result status is set back to `pending`. Local cancellations (abort controller signal) suppress retries. Max retries default: 1.

## 8. Workspace Type Workflow Catalog

Workflows are organized by workspace type in `WORKSPACE_TYPE_WORKFLOW_SEEDS`:

| Workspace Type | Workflows | Default |
|---------------|-----------|---------|
| ai-ideas | ai_usecase_generation_v1 | ai_usecase_generation_v1 |
| opportunity | opportunity_identification, opportunity_qualification | opportunity_identification |
| code | code_analysis | code_analysis |
| neutral | (none) | (none) |

On workspace creation, `seedWorkflowsForType` inserts workflow definitions, tasks, transitions, and agent definitions into the database for the workspace's type.

### Qualification and Code Workflows

- **opportunity_qualification** — Linear workflow: context_prepare -> demand_analysis -> solution_draft -> bid_preparation -> gate_review. All tasks use `noop` executor (placeholder for future implementation).
- **code_analysis** — Linear workflow: context_prepare -> codebase_scan -> issue_triage -> implementation_plan. All tasks use `noop` executor.
