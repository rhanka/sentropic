# SPEC EVOL - Agentic Workspace TODO (Residual Backlog Only)

Status: Residual-only after BR-03 docs consolidation (2026-03-02)

## 1) Consolidation baseline (already delivered)

The BR-03 delivered scope has been moved out of this evolution file into canonical specs:
- `spec/SPEC_CHATBOT.md`
- `spec/TOOLS.md`

This includes, at minimum:
- session-bound TODO runtime baseline,
- chat-bound steering baseline,
- workflow-based generation baseline,
- settings migration baseline within BR-03 boundaries.

Historical detailed design/delivery notes remain available in git history.

## 2) Remaining deferred evolution (still open)

### 2.1 BR15 robustness (authoritative operator config)

Deferred scope is tracked in:
- `spec/SPEC_EVOL_BR15_AGENT_WORKFLOW_CONFIG_ROBUSTNESS.md`

Open objective:
- robust agent prompt canonicalization,
- deterministic dedicated-field vs JSON save semantics,
- authoritative workflow task I/O contracts consumed by runtime.

### 2.2 Generic multi-workflow runtime → **delivered (BR-04)**

Delivered in BR-04 and consolidated into `spec/SPEC.md` §4.1 (Multi-workflow registry).

Scope delivered: open task-key mapping, per-workspace-type workflow catalog, generic dispatch via `startWorkflow(workspaceId, workflowKey)`, agent-based prompt resolution, `agentMap` runtime context. See `SPEC.md` §4 for canonical spec.

### 2.3 Collaborative TODO runtime (future branch)

Deferred outside BR-03:
- collaborative manual TODO editing,
- multi-user/multi-AI task ownership visualization,
- concurrent editing conflict UX.

Note: BR-04 neutral workspace todo automation (auto-creation from events, task dispatch) uses the standard todo model per D2 decision. It does not cover collaborative editing.

## 3) Scope rule for this file

This file must only keep deferred/residual evolutions.
Delivered behavior must be consolidated in canonical specs, not duplicated here.
