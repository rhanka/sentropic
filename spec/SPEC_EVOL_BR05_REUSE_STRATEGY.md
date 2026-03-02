# SPEC EVOL - BR05 Reuse Strategy (Mini Spec)

Status: Validated (Lot 0 scoping artifact for BR-05)

## 1) Objective
Keep BR-05 implementation lean by reusing existing runtime blocks instead of duplicating orchestration logic.

## 2) Reuse principles
- Reuse first; rewrite only when a legacy block conflicts with validated BR-05 scope.
- Keep one shared orchestration path per capability family.
- Avoid introducing parallel fake client contracts for VSCode when web/chat runtime already provides the contract.

## 3) Reuse matrix by lot

### Lot 1 (skeleton/build/download)
- Reuse API/UI download distribution patterns and packaging scripts from previously validated branch artifacts.
- Avoid rebuilding package/distribution plumbing from scratch when contracts already match BR-05 scope.

### Lot 2 (ChatWidget host integration)
- Reuse shared `ChatWidget` host runtime and existing settings/permissions interaction primitives.
- Do not create a parallel plugin-only chat panel contract.

### Lot 3 (tools)
- Reuse existing permission UX pattern (Chrome confirmation banner style) for tool confirmation.
- Reuse existing policy primitives where applicable; extend them for VSCode tool policy needs.
- Reuse one shared analysis engine for:
  - `documents.analyze`,
  - `history_analyze`.
- No duplicate chunk/analyze/merge orchestration pipelines.

## 4) Explicit non-reuse targets
- Legacy fake tabs and placeholder plugin-only shells are excluded from reuse.
- Any detached/background tool lifecycle in BR-05 is excluded (deferred to BR-10).

## 5) Consolidation rule
- This mini spec is a Lot 0 scoping artifact.
- In Lot N-1, merge durable rules into:
  - `spec/SPEC_EVOL_VSCODE_PLUGIN.md`,
  - `spec/TOOLS.md`,
  and remove this file.
