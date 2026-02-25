# SPEC VOL - Agentic Workspace TODO (Orientation Input)

Status: User orientation input (2026-02-25)
Scope reference: Intended as BR-03 functional direction (before implementation restart)

## 1) Intent
This document captures the user product orientation before rewriting BR-03.
It is an orientation baseline, not yet a full implementation spec.

## 2) Terminology (authoritative for next iterations)

### 2.1 Steer
`steer` means an in-flight guidance message sent to an active agent run to adjust direction.
It is not a permission workflow.

### 2.2 Guardrails
Use `guardrails` as the control concept (instead of governance wording):
- constraints shared by the executing agent and the conductor agent,
- constraints can be attached to a TODO or to a plan,
- constraints define execution frame in addition to tasks to be done.

### 2.3 Task
A `task` is the atomic executable unit.
Recommended statuses (to be finalized):
- `todo`: identified but not scheduled,
- `planned`: explicitly scheduled/ready,
- `in_progress`: currently being executed,
- `blocked`: cannot progress due to unmet dependency/guardrail,
- `done`: completed,
- `deferred`: intentionally postponed,
- `cancelled`: intentionally dropped.

### 2.4 TODO
A `todo` is an ordered set of tasks and/or nested todos (hierarchical model).
A TODO may be single-task.
A TODO has an owner responsible for closure.

### 2.5 Plan
A `plan` is an ordered set of TODO lots with dependencies:
- dependencies between TODOs,
- optionally dependencies between tasks.

### 2.6 Workflow
A `workflow` is a template of TODO/plan structures.
Workflows should be modeled as a library and become reusable orchestration blueprints.

## 3) Domain model orientation

### 3.1 Ownership and assignment
- A TODO has an `owner` (human user or AI agent identity).
- Any eligible user/agent may assign a TODO to another owner.
- Closing responsibility follows ownership.
- Tasks may also be individually assigned.

### 3.2 Structured task IO (optional)
A task may define:
- structured input contract,
- structured output contract,
- both optional.

### 3.3 Value and complexity framing
TODOs may be modeled as story-like lots (epic/user-story style) with:
- descriptive scope,
- optional value scoring dimensions:
  - time criticality,
  - business value,
  - risk reduction,
- optional complexity scoring:
  - flat Fibonacci by default,
  - optional axis-based complexity (matrix-compatible).

### 3.4 Attachments
A TODO/plan can attach existing domain objects:
- organization,
- folder,
- use case,
- other related runtime objects.

### 3.5 Automation hooks
Automations can be associated to TODOs and plans.
Automations are first-class runtime behavior and not limited to static metadata.

## 4) Agent interaction orientation

### 4.1 Plan tool
A `plan` tool should allow an AI agent to:
- create a simple TODO,
- create a full plan,
- update/refine existing TODO/plan structures.

### 4.2 Chat integration
Near-term UX target:
- render a simple TODO view in chat,
- allow a chat/AI agent to create TODOs,
- progressively expose planning interactions from chat.

### 4.3 Panel evolution (target direction)
Target panel composition should evolve toward:
- `Plan` / `Comments` / `Chat` / `Jobs`.
The current comments area is expected to evolve toward TODO-centric collaboration.

## 5) Workflow example (AI ideas generation)
Workflows are templates of TODO/plan execution.
Reference example:
1. user defines context (optionally linked to organization, case count, matrix options, model selection),
2. matrix generation agent may prepare evaluation frame,
3. list-generation agent creates candidate use cases,
4. TODO/plan is updated from generated list,
5. deep-dive agent iterates on selected use cases,
6. synthesis agent produces executive summary and prioritization matrix output.

## 6) Configuration and design direction
At configuration level, workflows should eventually support:
- create/duplicate/edit template workflows,
- workflow library management,
- explicit expected agent input/output contracts in workflow design.

This ergonomics is expected to be iterative and should not be over-committed in BR-03 restart.

## 7) Explicit out-of-scope for BR-03 restart
Not in BR-03:
- full folder view designer,
- object view designer (`usecase`, `plan`, etc.),
- final workflow design studio UX.

## 8) Open questions for next spec iteration
- Final status semantics and transition matrix for task/todo/plan.
- Ownership transfer + closure policy across humans and agents.
- Guardrails taxonomy and enforcement level per runtime context.
- Minimal automation contract for BR-03 vs deferred capabilities.
- Minimum workflow template schema needed before BR-04/BR-05 dependencies.

## 9) Next step
Use this input as the baseline for iterative spec hardening:
- complete contracts,
- explicit test questions,
- migration and API/UI boundaries,
- then recreate `03-BRANCH_feat-todo-steering-workflow-core` from the finalized spec.
