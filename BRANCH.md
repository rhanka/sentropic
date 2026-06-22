# Feature: IdP OIDC RP evolutions study (BR-63, immo-driven)

## Objective
Author an ARCHITECT study documenting two additive OIDC RP evolutions requested by the immo lane (BR-63): account switch + RP-initiated logout, and invitation → direct device-enrollment. Doc-only; implementation belongs to 39etc.

## Scope / Guardrails
- Doc-only: this study file + `BRANCH.md` only.
- Make-only workflow, no direct Docker commands.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_STUDY_IDP_OIDC_RP_EVOLUTIONS.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - any code paths (`packages/**`, `ui/**`, `apps/**`, `api/**`)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention`: implementation scope is **39etc** (auth lane), NOT this lane — this branch is doc-only. Priority of the implementation is the **owner's call** (not asserted urgent vs WP16 `#353`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: doc-only study, single file; no sub-workstreams, no CI matrix needed.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Author study**
  - [x] Write `spec/SPEC_STUDY_IDP_OIDC_RP_EVOLUTIONS.md` (verdict + 4 conditions, evolution 1 + 2).
  - [x] Create `BRANCH.md` from template (doc-only scope boundaries).
