# SPEC EVOL - Agentic Workspace TODO, Workflows, and Guardrails

Status: Draft v2 after user orientation review (2026-02-25)

## 1) Objective
Define the BR-03 restart as a real agentic TODO/plan runtime, with explicit in-flight steering, task ownership, guardrails, and workflow-driven orchestration for AI use-case generation.

This spec is the evolution target to finalize before recreating `03-BRANCH_feat-todo-steering-workflow-core.md`.

## 2) BR-03 Scope and Boundaries

In scope (BR-03):
- Core domain model for `task`, `todo`, and `plan`.
- Agent execution orchestration over tasks/todos/plans.
- In-flight `steer` messages during active runs.
- Guardrails as execution instructions at task/todo/plan levels.
- Basic workflow definition for AI use-case generation (as TODO/plan blueprint).
- Minimal UI:
  - in-chat rendering of TODO when the AI creates/uses one,
  - AI can create TODO from chat,
  - basic `Agent Configuration` + `Workflow Configuration` sections.

Out of scope (BR-03):
- Full Plan/Comments/Chat/Jobs operational panel (moved to BR-14).
- Full visual workflow designer (drag-and-drop/studio UX).
- Folder/object view designer (`usecase`, `plan`, etc.).
- Broad template catalog and multi-template workspace management (BR-04/BR-05).

## 3) Terminology (Authoritative)

### 3.1 Steer
`steer` is an in-flight guidance message sent to an active agent run to adjust trajectory.

### 3.2 Guardrails
`guardrails` are execution instructions and constraints shared between:
- the executing agent,
- the conductor/orchestrator agent (or human conductor).

Guardrails can be attached to:
- plan,
- todo,
- task.

### 3.3 Task
A `task` is the atomic executable unit.

### 3.4 TODO
A `todo` is an ordered set of tasks and/or nested TODOs (hierarchical).
A TODO may be single-task.

### 3.5 Plan
A `plan` is an ordered set of TODO lots with dependencies between TODOs and optionally between tasks.

### 3.6 Workflow
A `workflow` is a reusable blueprint of TODO/plan structures, agents, guardrails, and expected data contracts.

## 4) Naming Option Evaluation: `workflow` vs `workflow_template`

Option A - Use `workflow` everywhere:
- Pros: simple product language, aligns with user vocabulary.
- Cons: can blur runtime instances vs reusable definitions.

Option B - Use `workflow` (product) + `workflow_template` (technical persistence):
- Pros: clear separation between definition and instantiated execution.
- Cons: adds one technical term in implementation.

Recommendation:
- Product/UI language: `workflow`.
- Technical model/API internals: keep explicit definition entities (e.g., `workflow_template`) where instance/definition distinction matters.

## 5) Status Model Challenge and Proposal

Agile/common practice suggests explicit separation between:
- backlog state,
- ready/planned state,
- active execution,
- blocked,
- completion,
- deferred/cancelled.

Proposed v1 task statuses:
- `todo`
- `planned`
- `in_progress`
- `blocked`
- `done`
- `deferred`
- `cancelled`

Why this set:
- keeps planning (`planned`) distinct from raw backlog (`todo`),
- keeps postponement (`deferred`) distinct from abandonment (`cancelled`),
- avoids premature review states (`in_review`) for v1 simplicity.

Proposed v1 allowed transitions:
- `todo -> planned | in_progress | deferred | cancelled`
- `planned -> in_progress | blocked | deferred | cancelled`
- `in_progress -> done | blocked | deferred | cancelled`
- `blocked -> planned | in_progress | deferred | cancelled`
- `deferred -> planned | cancelled`
- terminal: `done`, `cancelled`

## 6) Ownership and Assignment Rules

- TODO creator may assign TODO to self or another owner (human or agent identity).
- TODO owner may:
  - reassign the TODO owner,
  - reassign tasks within that TODO.
- TODO creator may create and modify tasks in that TODO.
- Closing responsibility is owned by the current TODO owner.

## 7) Guardrails and Validation Semantics

Guardrails are instruction-level constraints (not schema validation rules).

Format validation is handled by workflow/task IO contracts:
- task input contract,
- task output contract,
- optional but strongly recommended for automated execution.

Proposed v1 guardrail categories:
- `scope` (what must not be changed),
- `quality` (minimum output criteria),
- `safety` (forbidden actions),
- `approval` (human validation required before transition).

## 8) Execution Modes and Conductor Semantics

### 8.1 Manual mode
- Conductor (human/agent) triggers execution and validates task completion explicitly.

### 8.2 Sub-agentic mode
- Conductor chooses between:
  - assigning a TODO/plan path to an agent,
  - sending a direct prompt with selected context.
- Conductor validates completion from returned output.

### 8.3 Full-automation mode
- Assigned/hardcoded agent executes tasks end-to-end.
- Orchestrator auto-validates task completion on contract-compliant output.

Context rule:
- Assigned agent receives only the input context selected by conductor/orchestrator for that task.

## 9) UI v1 Scope Proposal

### 9.1 In-chat TODO display and creation
- If AI decides to create/use a TODO, chat renders a TODO card/list inline.
- Chat/agent can create TODO and tasks via `plan` tool APIs.

### 9.2 Basic Agent Configuration section
- Configure generation agents (currently prompt-backed).
- Fork lineage model:
  - code baseline -> admin reference -> user fork.
- Inheritance behavior:
  - if untouched, child tracks parent updates,
  - user may detach from parent,
  - if user edits while attached, UI shows drift notification.

### 9.3 Basic Workflow Configuration section
- Start with one workflow: AI use-case generation.
- Same fork lineage model as agents (code -> admin -> user).
- Display workflow as ordered tasks with assigned agents.
- Display workflow purpose/description and task labels.
- Display objects and data format definitions as expandable sections.

Placeholder extraction behavior:
- Prompt placeholders like `{{object_name}}` create/update object references in workflow metadata.
- Advanced object editors (Drizzle/TypeScript/JSON/typed hierarchical UI) can be phased:
  - v1: structured JSON editor + validation,
  - richer editors deferred.

### 9.4 Explicit panel decision
- No broad operational panel in BR-03.
- Create BR-14 for full panel evolution (`Plan / Comments / Chat / Jobs`).

## 10) Data Model Proposal (BR-03)

Proposed minimal entities:
- `plans`
- `todos`
- `tasks`
- `todo_dependencies` (todo-to-todo)
- `task_dependencies` (optional)
- `task_io_contracts` (input/output schema references)
- `guardrails` (attached to plan/todo/task)
- `workflow_definitions` (definition payload + lineage metadata)
- `workflow_definition_tasks` (ordered blueprint tasks)
- `agent_definitions` (prompt/config + lineage metadata)
- `entity_links` (polymorphic links from plan/todo/task to domain objects)
- `execution_runs` and `execution_events` (including `steer`)

Attachment strategy (answer to FK concern):
- prefer one polymorphic link table (`entity_links`) over many nullable FKs,
- enforce integrity via controlled `object_type` + `object_id` validation in service layer.

## 11) Automation Proposal (BR-03 v1)

Supported automation triggers:
- task created,
- task completed,
- todo completed,
- guardrail violation,
- steer message received.

Supported v1 actions:
- enqueue next task,
- assign task to agent,
- emit notification/event,
- request approval,
- open follow-up task automatically.

Non-goal v1:
- unrestricted arbitrary automation scripting.

## 12) API Contract Proposal (BR-03 v1)

Core TODO/plan APIs:
- `POST /api/v1/plans`
- `PATCH /api/v1/plans/:planId`
- `POST /api/v1/plans/:planId/todos`
- `PATCH /api/v1/todos/:todoId`
- `POST /api/v1/todos/:todoId/tasks`
- `PATCH /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/assign`
- `POST /api/v1/todos/:todoId/assign`

Execution APIs:
- `POST /api/v1/tasks/:taskId/start`
- `POST /api/v1/tasks/:taskId/complete`
- `POST /api/v1/runs/:runId/steer`
- `POST /api/v1/runs/:runId/pause`
- `POST /api/v1/runs/:runId/resume`

Configuration APIs:
- `GET|PUT /api/v1/agent-config`
- `POST /api/v1/agent-config/:id/fork`
- `POST /api/v1/agent-config/:id/detach`
- `GET|PUT /api/v1/workflow-config`
- `POST /api/v1/workflow-config/:id/fork`
- `POST /api/v1/workflow-config/:id/detach`

## 13) Branch Dependencies and Sequencing

- BR-03 provides core runtime contracts.
- BR-04 consumes BR-03.
- BR-05 consumes BR-03.
- BR-14 handles full panel UX evolution.

## 14) Migration Strategy Proposal (BR-03)

Given one migration max policy for BR-03:
- prefer one consolidated migration creating the minimal stable v1 tables,
- avoid speculative columns for deferred BR-14 UX,
- include lineage fields required by fork semantics from day 1.

Suggested lineage fields (agent/workflow definitions):
- `lineage_root_id`
- `parent_id`
- `source_level` (`code`, `admin`, `user`)
- `is_detached`
- `last_parent_sync_at`

## 15) Test and Gate Proposal (BR-03)

API tests:
- status transition matrix,
- ownership and reassignment permissions,
- guardrail enforcement,
- execution mode behavior (`manual`, `sub_agentic`, `full_auto`),
- steer event handling.

UI tests:
- in-chat TODO rendering,
- TODO creation from chat flow,
- agent/workflow config fork, detach, inheritance drift indicators.

E2E tests:
- create TODO in chat and execute first tasks,
- sub-agentic conductor validation path,
- full-auto progression path with contract-compliant output.

## 16) Open Questions to Resolve Before BR-03 Branch Recreation

- Final status values for TODO and plan aggregates (derived vs explicit states).
- Exact actor permission matrix between creator, owner, assignee, and admins.
- Minimum required guardrail taxonomy for v1 launch.
- Final IO schema format (`json_schema` only vs typed internal DSL).
- Scope of object placeholder extraction in v1 editor.

## 17) Acceptance Criteria (Spec Readiness)

This spec iteration is ready to instantiate BR-03 only when:
- terminology is frozen,
- transition matrix is accepted,
- execution mode semantics are accepted,
- API surface v1 is accepted,
- migration scope v1 is accepted,
- BR-03/BR-04/BR-05/BR-14 boundaries are accepted.
