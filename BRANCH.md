# Feature: Wave 2 - Mono-branch integration (i18n + matrix + executive synthesis print)

## Objective
Deliver Wave 2 features sequentially on a single integration branch (`feat/i18-print`) with partial UAT after each coherent lot, and defer full automated tests to Lot N.

## Scope / Guardrails
- Make-only workflow (no direct Docker or npm).
- All new text in English (docs/commits/errors).
- Partial UAT lots are mandatory; full test suites are deferred to Lot N.
- Avoid unrelated refactors; keep changes minimal per lot.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + sequential lots**
- Rationale: Reduce coordination overhead and run UAT on a single integrated environment.

## UAT Management
- Before each UAT lot: run the relevant gates (`make typecheck-*`, `make lint-*`).
- Keep UAT checklists inside each lot as `[ ]` items. Do not tick UAT items before the user executes them.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and rules**
  - [ ] Read `.cursor/rules/MASTER.mdc` and `.cursor/rules/workflow.mdc`.
  - [ ] Read relevant scope rules (`architecture.mdc`, `testing.mdc`, `data.mdc`, `security.mdc`).
  - [ ] Confirm current branch is `feat/i18-print` and aligned with `origin/main`.

- [ ] **Lot 1 — Bilingual foundation (model + prompts)**
  - [ ] Implement bilingual modeling (API schema/types + UI typing + normalization; legacy compatibility).
  - [ ] Implement bilingual prompt selection (FR/EN) with explicit fallback behavior.
  - [ ] Gates:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] `make typecheck-ui` + `make lint-ui` (if UI touched)
  - [ ] Partial UAT (user-driven):
    - [ ] Edit a use case in FR and EN and confirm both variants persist after refresh.
    - [ ] In FR UI, generate a use case and confirm generated narrative is in French.
    - [ ] In EN UI, generate a use case and confirm generated narrative is in English.
    - [ ] Switch locale without reload and confirm new generations follow current locale.
    - [ ] Validate fallback when the requested locale prompt variant is missing.

- [ ] **Lot 2 — Matrix generation per organization/folder**
  - [ ] Implement matrix generation flow for organization-level default template.
  - [ ] Implement folder generation option for matrix reuse vs folder-specific generation.
  - [ ] Persist and expose matrix selection in API/UI.
  - [ ] Gates:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] `make typecheck-ui` + `make lint-ui`
  - [ ] Partial UAT (user-driven):
    - [ ] Generate a first folder for an organization and verify matrix template is created/stored at org level.
    - [ ] Generate a second folder with default option and verify stored org matrix is reused.
    - [ ] Generate folder with "specific matrix" option and verify it differs from org default.
    - [ ] Verify matrix selection/options are visible and persisted in folder generation UI.

- [ ] **Lot 3 — Executive synthesis multipage DOCX (template-driven)**
  - [ ] User intake (single bundle):
    - [ ] Provide `executive-synthesis.docx` master template.
    - [ ] Provide annex intent (append use cases: yes/no; new page per use case: yes/no).
    - [ ] Provide dashboard intent (include dashboard image: yes/no).
    - [ ] Provide one reference dataset for UAT (folder id with executive summary + multiple use cases).
  - [ ] Implement unified DOCX generation endpoint strategy for synthesis (no hardcoded document structure).
  - [ ] Implement master-template-driven synthesis composition (marker-driven ordering).
  - [ ] Implement annex insertion at template-defined marker.
  - [ ] Implement dashboard bitmap injection at template-defined marker (deterministic sizing + fallback).
  - [ ] Gates:
    - [ ] `make typecheck-api` + `make lint-api`
  - [ ] Partial UAT (user-driven):
    - [ ] Download synthesis DOCX and verify master template controls section order.
    - [ ] Verify annex starts at template-defined separator/location.
    - [ ] Verify dashboard bitmap is inserted at expected marker and rendering is readable.
    - [ ] Regression: use-case one-page DOCX export still works from use case detail.

- [ ] **Lot N — Final validation**
  - [ ] Consolidate deferred test backlog (API/UI/E2E) based on lots 1-3.
  - [ ] `make test-api`
  - [ ] `make test-ui`
  - [ ] `make build-api build-ui-image`
  - [ ] `make clean test-e2e`
  - [ ] Final gate: PR ready and CI green for `feat/i18-print`.

