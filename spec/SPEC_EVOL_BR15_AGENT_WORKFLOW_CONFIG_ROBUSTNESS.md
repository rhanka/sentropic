# SPEC EVOL - BR15 Agent/Workflow Config Robustness

Status: Draft for BR15 carry-over from BR03 S30 rollback (2026-03-01)

## 1) Context

BR03 introduced settings surfaces for agent/workflow runtime configuration. UAT and implementation review exposed structural gaps that make the current operator experience unsafe:

- Agent prompt editing uses a key that is not consumed by generation runtime.
- Prompt dedicated field and raw JSON editor can conflict with each other.
- Workflow task I/O fields are editable but not authoritative for generation runtime behavior.
- Input contracts are not modeled as explicit per-object contracts aligned with placeholder/object usage.

This scope is removed from BR03 (`L4-S30`) and deferred to BR15 for a robust implementation.

## 2) Problem Statement

### P1. Prompt source mismatch
- UI reads/writes `config.prompt`.
- Runtime generation resolution reads `config.promptTemplate`.
- Result: prompt field may appear empty or not effective at runtime.

### P2. Dual-edit conflict (prompt field + JSON field)
- Same semantic field can be modified in two places with no deterministic conflict policy.
- Result: last-write wins behavior can silently override operator intent.

### P3. Non-authoritative workflow task I/O editing
- Task I/O can be edited in settings but runtime still relies on hardcoded structured schemas in generation services.
- Result: false sense of control; configuration and execution can diverge.

### P4. Missing object-level I/O contract model
- Inputs are not explicitly modeled as a list/map of workflow objects with schema per object.
- Placeholder extraction metadata exists but is not a runtime contract object map.

### P5. Destructive save semantics
- Workflow PUT rewrites task rows in bulk.
- Without strong contract validation and lineage-safe merge, operator saves can degrade runtime consistency.

## 3) BR15 Objective

Deliver a robust and authoritative operator configuration model for generation agents/workflows:

1. One canonical prompt source consumed by runtime and edited by UI.
2. Deterministic save semantics when dedicated fields and JSON payload coexist.
3. Workflow task I/O modeled as explicit object contracts.
4. Runtime execution consuming workflow I/O contracts (or explicit documented fallback policy).
5. Strong validation and clear operator feedback before persistence.

## 4) Scope (BR15)

In scope:
- Agent prompt canonicalization and settings UX consistency.
- Workflow task input/output contract model redesign (object-level inputs + output schema).
- Runtime wiring from workflow task contracts to generation execution.
- API/UI/E2E tests for end-to-end configuration authority.

Out of scope:
- Full workflow visual designer.
- Multi-workflow marketplace/catalog UX.
- Non-generation workflow families beyond BR15 target chain.

## 5) Design Decisions

### D1. Canonical prompt key
- Canonical runtime prompt key for generation agents: `config.promptTemplate`.
- UI dedicated prompt field must bind to `promptTemplate` (read + write).
- `config.prompt` is non-canonical and must not drive generation runtime.

### D2. Dedicated-field vs JSON editor contract
- JSON editor remains for advanced config, but prompt fields are protected by deterministic policy:
  - Option A (recommended): prompt keys are excluded/locked in raw JSON editor and controlled only by dedicated prompt UI.
  - Option B: allow both but enforce explicit conflict detection with blocking error and resolution choice.
- No silent overwrite.

### D3. Effective prompt transparency
- Agent editor shows:
  - effective prompt source (`promptTemplate` from current config),
  - prompt id (if any),
  - lineage source (`code/admin/user`, detached/attached),
  - drift warning when parent sync diverges.

### D4. Workflow task I/O object model
- Replace implicit single blob semantics with explicit contract shape:
  - `inputs`: object map keyed by object token/key.
  - each input object contains at least `schema`, optional `required`, optional `sourceRef`.
  - `output`: explicit schema object.
- Placeholder/object linkage must map to `inputs` keys (validation at save time).

### D5. Runtime contract authority
- Generation runtime must consume workflow task contracts from persisted workflow definitions.
- Hardcoded schemas in service code become fallback only (temporary) and must be explicitly tagged/deprecated in BR15.
- Target end state: workflow task contracts are authoritative.

### D6. Save safety
- Workflow updates must preserve referential consistency and avoid silent destructive rewrites.
- If full-rewrite strategy is kept, apply strict preflight validation and transactional guarantees with contract checks.

## 6) Data Contract Proposal (BR15)

For each `workflow_definition_tasks` row:

- `inputSchema` structure:
```json
{
  "inputs": {
    "organization_info": {
      "required": true,
      "sourceRef": "context.organization",
      "schema": { "type": "object" }
    },
    "folder_context": {
      "required": true,
      "sourceRef": "context.folder",
      "schema": { "type": "object" }
    }
  }
}
```

- `outputSchema` structure:
```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

## 7) Validation Rules

### Agent config
- `promptTemplate` must be non-empty for generation agents that require a prompt.
- `promptId` and `promptTemplate` consistency rules must be explicit (allowed mismatch only with warning and rationale).

### Workflow config
- Every generation task must have `agentDefinitionId`.
- `inputSchema.inputs` keys must match declared placeholders/object references when applicable.
- `outputSchema` must be valid JSON schema object.
- Save rejected on contract inconsistency.

## 8) Implementation Slices (BR15)

- `BR15-S1`: Prompt canonicalization (`promptTemplate`) + UI binding fix.
- `BR15-S2`: Conflict-safe save semantics (dedicated fields vs JSON).
- `BR15-S3`: Workflow input object-map contract model in settings/API.
- `BR15-S4`: Runtime consumption of task I/O contracts (remove hardcoded authority).
- `BR15-S5`: Backfill/migration script and safe defaults for existing rows.
- `BR15-S6`: Regression suite (API/UI/E2E) + UAT playbook.

## 9) Test Plan (required)

API:
- `agent-config` persistence and canonical prompt read/write behavior.
- `workflow-config` validation for input object map/output schema.
- runtime generation route uses persisted contracts.

UI:
- prompt field prefilled from canonical key and persists correctly.
- JSON editor conflict prevention behavior.
- workflow task I/O editor validates and persists object-level contracts.

E2E:
- `/settings` edit/save/reload for prompt + task I/O.
- run a generation and verify effective prompt/contract usage follows saved config.

## 10) Acceptance Criteria

- No empty prompt field when runtime prompt exists for a generation agent.
- Editing prompt via UI changes effective runtime prompt deterministically.
- No silent conflict between dedicated prompt field and JSON editor.
- Workflow I/O edits are authoritative (or fallback policy explicitly visible and tested).
- UAT can validate behavior without code-level assumptions.
