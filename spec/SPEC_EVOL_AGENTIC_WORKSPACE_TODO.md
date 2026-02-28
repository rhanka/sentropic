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
- Chat/agent can create TODO and tasks via `todo_create` chat tool orchestration.

### 9.1.1 Session-bound TODO runtime follow-up (Lot 4 target)
- A TODO created from chat is attached to the chat session.
- v1.1 UI behavior:
  - sticky container at the bottom of the conversation,
  - full-width layout,
  - collapsible panel,
  - reduced max-height with internal scroll (about 70% of previous opened height),
  - panel title label is simply `TODO` (no technical runtime wording in the primary title),
  - technical metadata (`status`, `plan id`, `todo id`, `run id`, `run status`, `run task id`) is not displayed in the panel UI.
- Typography contract:
  - checklist item font size aligns with the panel subtitle scale (no oversized task rows),
  - completed tasks remain rendered as checked + struck-through.
- At most one active TODO per chat session in BR-03 v1.1.
- Collaborative manual edition of TODO content is out of scope for BR-03 and deferred.

### 9.1.2 Steering UX contract (Lot 4 target)
- Steering is in-flight guidance on the active execution run; it is not a second chat thread.
- Steering input is performed from the main chat composer when the assistant is actively running and a steerable run is available.
- Composer behavior:
  - send action switches to steering mode while run execution is active,
  - steering submission uses `POST /api/v1/runs/:runId/steer`,
  - steering does not interrupt currently running tools/execution.
- Message behavior:
  - steering message is appended as a normal user bubble in the conversation timeline (same session, no side-thread),
  - the reasoning/tool strip immediately shows an acknowledgment state equivalent to "new user message taken into account",
  - if the assistant already started a final response, an additional assistant continuation bubble may be produced (additive behavior, no cancellation).
- Dedicated standalone steer input block inside the TODO runtime panel is out of scope for this target behavior.

### 9.1.3 Execution handshake for TODO progression (Lot 4 target)
- TODO in chat is an executable AI plan, not a static checklist.
- After `todo_create`, assistant asks for explicit user confirmation (`go`) before autonomous progression actions.
- After confirmation, assistant must use progression tools to reflect concrete execution:
  - `todo_update` for TODO-level progression,
  - `task_update` for task-level progression.
- Progression must be incremental and stateful (checklist updates during execution, not bulk end-state only).
- Autonomous progression scope after `go`:
  - allowed without extra user confirmation: status/progression updates on existing TODO/tasks (`todo_update` / `task_update`, including checking tasks as done),
  - forbidden without explicit user intent in the conversation: structural list mutations (adding, removing, reordering, or replacing tasks/TODO content).
- Structural mutations are intent-driven operations:
  - if the user explicitly asks to change plan content, assistant applies requested mutations directly,
  - assistant must not perform silent plan reshaping while executing the current list.

### 9.1.4 LLM context injection for active TODO (Lot 4 target)
- Do not overload `chat_reasoning_effort_eval` with TODO payloads.
- If a session has an active TODO, inject a compact TODO summary directly in the main chat system prompt context block (`chat_system_base` path).
- The summary is always provided to the generation model for each turn while the TODO remains active (no explicit re-fetch request required from the model).
- `chat_conversation_auto` must explicitly nudge TODO usage for long/iterative workloads (for example: processing many URLs, folders, or object batches), so the assistant structures execution with `todo_create` + progression tools instead of ad-hoc free-text steps.
- Runtime orchestration rules (normative):
  - If a session TODO is active, prioritize its progression before any new plan creation.
  - For long or iterative workloads (URLs, folders, object batches), structure execution through the active TODO.
  - Progress deterministically task by task, and persist task/TODO updates during execution (not only at end state).
  - Ask blocking questions upfront (batched), then execute autonomously until a real blocker appears.
  - Structural mutations are forbidden without explicit user intent: do not add/remove/reorder/replace TODO content silently.
  - Do not call `todo_create` when an active TODO exists, except on explicit user request for replacement/new list.
- Summary format stays compact (about 6 lines), for example:
  - active TODO title,
  - global progression (`done/total`),
  - next actionable tasks (ordered),
  - orchestration rule reminder (continue current TODO unless explicit replacement request).
- User-facing conflict banners for "active TODO already exists" are not required; this signal is meant for tool orchestration/model behavior.

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
- steer message received,
- user steer acknowledgment surfaced in runtime stream state.

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

Chat tool contract (BR-03):
- `todo_create` is required for AI-created TODO bootstrap from chat.
- TODO progression updates from chat (task/todo status mutation) are required in Lot 4 (`todo_update` / `task_update`) and must be operational in normal assistant turns.
- Steering must stay on the same run path (`POST /api/v1/runs/:runId/steer`) and remain non-interrupting for in-flight tool execution.
- Execution handshake requires explicit user confirmation before automatic TODO progression (`go` semantics).

### 12.1 AI use-case generation workflow runtime migration (Lot 4 mandatory)

Goal:
- Replace the full AI use-case generation hardcoded treatment by workflow runtime definitions and agents.
- No data migration is required: generation remains a treatment that produces existing artifacts.
- Keep zero dual-path in production behavior (no permanent legacy hardcoded chain kept in parallel).

Legacy hardcoded chain (to replace):
1. `POST /api/v1/use-cases/generate` enqueues `matrix_generate` (optional) and `usecase_list`.
2. `usecase_list` processing creates draft use cases then auto-enqueues one `usecase_detail` per use case.
3. `usecase_detail` processing auto-enqueues `executive_summary` once all use cases are completed.

Target workflow definition:
- workflow key: `ai_usecase_generation_v1`
- trigger: `POST /api/v1/use-cases/generate` starts one workflow run instance bound to this definition.
- execution records must carry workflow/agent lineage for each task run (`workflowDefinitionId`, `agentDefinitionId`).

Target mapping (legacy -> workflow tasks):

| Legacy behavior | Target `taskKey` | Target agent key | Minimum input contract | Minimum output contract |
|---|---|---|---|---|
| Request normalization in route + folder context setup | `generation_context_prepare` | `generation_orchestrator` | `workspaceId`, `folderId`, `organizationId?`, `input`, `matrixMode`, `model`, `useCaseCount`, `locale` | normalized generation context |
| Optional matrix generation (`matrix_generate`) | `generation_matrix_prepare` | `matrix_generation_agent` | normalized context + organization payload | persisted matrix config + matrix metadata |
| Use-case list generation (`usecase_list`) | `generation_usecase_list` | `usecase_list_agent` | context + matrix state + docs context | draft use-case list with stable identifiers |
| New TODO synchronization from generated list | `generation_todo_sync` | `todo_projection_agent` | generated list + session context | session TODO updated (tasks/ordering/progression baseline) |
| Use-case detail generation fanout (`usecase_detail` for each item) | `generation_usecase_detail` | `usecase_detail_agent` | one draft use-case + matrix + organization + docs context | completed use-case payload + validated scores |
| Executive synthesis (`executive_summary`) | `generation_executive_summary` | `executive_synthesis_agent` | completed use cases + thresholds + folder context | persisted executive summary payload |

Migration constraints:
- Runtime route contract stays stable (`POST /api/v1/use-cases/generate`), but internal dispatch must go through workflow runtime.
- The direct legacy enqueue chain from route-level generation (`matrix_generate`, `usecase_list`, downstream chaining) must be removed from the route path once Lot 4 is complete.
- Queue workers may remain as low-level executors, but they must be invoked through workflow task orchestration (not through legacy hardcoded orchestration branching).
- No fallback mode that silently runs both legacy and workflow chains for the same request.

Migration acceptance checkpoints:
- `execution_runs.workflow_definition_id` is non-null for generation workflow task runs.
- `execution_runs.agent_definition_id` is non-null when task assignment is defined in workflow configuration.
- Generated artifacts (matrix, use-case list/detail, executive summary) remain functionally equivalent at API/UI level.
- BR-03 TODO runtime progression (`todo_update` / `task_update`) is available in the same lot so generated plans are actionable in chat.

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

## 18) Future To-Be (outside BR-03)

- Collaborative TODO boards (multi-user + multi-AI) are deferred.
- Future UX should expose actor identity in TODO/task history and assignment surfaces (e.g., avatar/logo markers per actor).
