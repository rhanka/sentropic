# Feature: BR-21a Profile PPTX Export

## Objective
Extract the PPTX generation slice from BR-21 into a micro-branch. Implement the `pptxgenjs` profile presentation renderer for one-page CV/profile slides, without taking ownership of the full CV transpose workflow.

## Scope / Guardrails
- Scope limited to the PPTX rendering/export slice described in `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md` §5b and `plan/21-BRANCH_feat-cv-transpose-profiles.md` Lot 4.
- Branch development happens in isolated worktree `tmp/feat-profile-pptx-export-21a`.
- Make-only workflow, no direct Docker commands.
- Automated tests must use dedicated environments, never root `dev`.
- Environment mapping: `API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=feat-profile-pptx-export-21a`.
- Test mapping: `API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-profile-pptx-export-21a`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/profile-pptx.ts`
  - `api/src/services/profile-pptx/**`
  - `api/src/routes/api/**profile**`
  - `api/tests/unit/*profile*pptx*.test.ts`
  - `api/tests/api/*profile*.test.ts`
  - `api/assets/profile-templates/**`
  - `plan/21a-BRANCH_feat-profile-pptx-export.md`
  - `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `README.md`
  - `README.fr.md`
  - `TRANSITION.md`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/**`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `tmp/feat-llm-mesh-sdk/**`
  - `tmp/feat-gdrive-sso-indexing-16a/**`
  - `tmp/feat-cv-transpose-profiles-21/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `PLAN.md`
  - `TODO.md`
  - `api/package.json`
  - `api/package-lock.json`
  - `api/src/db/schema.ts`
  - `api/drizzle/*.sql`
  - `ui/**`
  - `e2e/**`
  - `scripts/**`
- **Exception process**:
  - Declare exception ID `BR21a-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] `attention` BR21a-Q1 — Data dependency: should 21a define a minimal profile fixture/contract only, or wait for BR-21 data model and profile API?
  - 1A (recommended): Define a minimal `ProfileData` fixture/contract in tests and keep runtime integration thin.
  - 1B: Wait for BR-21 Lots 1-2 before implementing PPTX.
  - 1C: Implement missing minimal profile API/model in 21a.
- [ ] `attention` BR21a-Q2 — Initial PPTX target.
  - 2A (recommended): Default one-page generated slide with deterministic layout.
  - 2B: Template-from-example first.
  - 2C: Both in 21a.
- [ ] `attention` BR21a-Q3 — Integration endpoint.
  - 3A (recommended): Implement renderer/service + tests first; endpoint wiring waits for BR-21 profile API.
  - 3B: Add/extend `POST /profiles/:id/export?format=pptx` in 21a.
  - 3C: Provide a dev/test-only export route.
- [ ] `attention` BR21a-EX1 — `api/package.json` and `api/package-lock.json` are conditionally allowed if `pptxgenjs` is not already installed. Reason: renderer dependency. Impact: dependency metadata only. Rollback: remove dependency and renderer import.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Locate BR-21 PPTX scope in plan/spec.
  - [x] Create isolated worktree `tmp/feat-profile-pptx-export-21a` from current `main`.
  - [x] Copy root `.env` into the branch worktree.
  - [x] Confirm active branch `feat/profile-pptx-export-21a`.
  - [x] Define environment and test mappings.
  - [ ] Finalize BR21a-Q1 to BR21a-Q3 before implementation.

- [ ] **Lot 1 — PPTX renderer contract**
  - [ ] Define the profile-to-slide input contract.
  - [ ] Define deterministic layout constraints for one-page profile slides.
  - [ ] Add fixture profile data and snapshot-friendly assertions.

- [ ] **Lot 2 — `pptxgenjs` renderer**
  - [ ] Add `pptxgenjs` dependency if required through BR21a-EX1.
  - [ ] Implement `api/src/services/profile-pptx.ts`.
  - [ ] Generate a one-page PPTX buffer for a structured profile fixture.
  - [ ] Gate: typecheck/lint/API unit tests.

- [ ] **Lot 3 — Integration seam**
  - [ ] Provide integration seam for BR-21 profile export endpoint.
  - [ ] Avoid owning full CV transpose data model unless explicitly approved.
  - [ ] Gate: focused API tests where possible.

- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update `spec/SPEC_EVOL_CV_TRANSPOSE_PROFILES.md` with final 21a boundaries.
  - [ ] Update `plan/21-BRANCH_feat-cv-transpose-profiles.md` to mark PPTX renderer as delegated to BR-21a if needed.

- [ ] **Lot 5 — Final validation**
  - [ ] `make typecheck-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-profile-pptx-export-21a`
  - [ ] `make lint-api API_PORT=8722 UI_PORT=5122 MAILDEV_UI_PORT=1022 ENV=test-feat-profile-pptx-export-21a`
  - [ ] Focused API/unit tests for profile PPTX renderer.
  - [ ] PR, CI, UAT if there is a user-visible export path.
  - [ ] Remove `BRANCH.md` before merge once CI + UAT are both OK.
