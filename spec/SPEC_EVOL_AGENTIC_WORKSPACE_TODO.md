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

### 2.2 Generic multi-workflow runtime (future branch)

Current BR-03 implementation limits (kept explicit as temporary constraints):
- generation task identity is still constrained by a closed compile-time task-key set,
- orchestration routing still contains generation-specific switch/enum logic,
- task assignment still relies on generation-specific fixed fields,
- workflow `config` is metadata-oriented and not yet a full executable graph contract,
- fanout/chaining for generation remains partially encoded in worker orchestration,
- generation bootstrap still reuses legacy prompt defaults for initialization compatibility,
- the runtime still assumes one canonical generation workflow key.

Future target (post BR-03):
- open runtime model for multiple workflows,
- reusable workflow library/catalog,
- executable graph semantics (edges/conditions/fanout) driven by persisted workflow objects,
- generic `taskKey -> capability/agent` mapping without generation-specific hardcoding.

### 2.3 Collaborative TODO runtime (future branch)

Deferred outside BR-03:
- collaborative manual TODO editing,
- multi-user/multi-AI task ownership visualization,
- concurrent editing conflict UX.

## 3) Scope rule for this file

This file must only keep deferred/residual evolutions.
Delivered behavior must be consolidated in canonical specs, not duplicated here.
