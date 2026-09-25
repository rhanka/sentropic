# Feature: Freeze auth-hono, build-cli and focus out of bootstrap publish

## Objective
Technically lock the owner-frozen packages `@sentropic/auth-hono`, `@sentropic/build-cli` and `@sentropic/focus` out of the `ci.yml` bootstrap publish path (dispatch options, guard allow-list, bootstrap steps) until the owner decides on their existence.

## Scope / Guardrails
- Scope limited to the `ci.yml` bootstrap input and `bootstrap-publish` job, the declared bootstrap target list and the CI wiring test under `scripts/ci/`, and one line of `rules/workflow.md`.
- Make-only workflow, no direct Docker commands.
- No publish, no workflow dispatch, no trusted publisher change, no branch protection change, nothing under `packages/**`. No push.
- In every `make` command, `ENV=<env>` must be passed as the last argument (`ENV=test-bootstrap-freeze`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-manifests.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` (BR99-EX1)
  - `rules/workflow.md` (BR99-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge` BR99-EX1: `.github/workflows/ci.yml`, limited to the `bootstrap_publish_target` options and the `bootstrap-publish` job (guard allow-list + removal of the three `Bootstrap publish <slug>` steps for auth-hono, build-cli, focus). Reason: owner freeze, these packages must not be published by any path. Impact: bootstrap dispatch can no longer target them; steady-state OIDC publishers unchanged. Rollback: re-add the three options, allow-list entries and three bootstrap steps (git revert of the lot commit). Rollback also covers `BOOTSTRAP_TARGETS`, the frozen wiring test and the `rules/workflow.md` line (same revert).
- [x] `acknowledge` BR99-EX2: `rules/workflow.md` Package Publication, one line stating the frozen packages are not bootstrap targets until the owner decides. Reason: keep the rule aligned with the workflow. Impact: documentation only. Rollback: revert the line (git revert of the lot commit).
- [ ] `attention` (owner): residual publish paths remain for the frozen packages. Steady-state jobs `publish-auth-hono` and `publish-build-cli` in `ci.yml`, and the `make publish-<slug>` / `make publish-<slug>-token` recipes (including focus) are untouched (out of brief scope). They only trigger on `packages/<slug>/**` changes and currently fail with ENEEDAUTH (no trusted publisher), but attaching a trusted publisher or a manual token run would re-open publication. Owner decision needed.
- [ ] `attention`: the three slugs are also removed from `BOOTSTRAP_TARGETS` in `scripts/ci/publishable-manifests.mjs` (the wiring test requires it to equal the bootstrap steps); the manifest guard now rejects them as unknown bootstrap targets. Conservative, reversible (same revert).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single micro CI lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/bootstrap-freeze` on branch `ci/bootstrap-freeze`.
  - [x] Declare BR99-EX1 and BR99-EX2.

- [x] **Lot 1 — Bootstrap freeze**
  - [x] Remove auth-hono, build-cli, focus from `bootstrap_publish_target` options.
  - [x] Remove them from the guard step allow-list.
  - [x] Remove their `Bootstrap publish <slug>` steps.
  - [x] Remove them from `BOOTSTRAP_TARGETS`.
  - [x] Wiring test: FROZEN list absent from options, allow-list, steps and `BOOTSTRAP_TARGETS`; one step per declared option still asserted.
  - [x] `rules/workflow.md`: one frozen-packages line.
  - [x] Lot gate:
    - [x] `make test-publishable-manifests ENV=test-bootstrap-freeze` (63 pass, 0 fail)
    - [x] `make check-ci-version-filters ENV=test-bootstrap-freeze` (pass)
    - [x] `make scope-check ENV=test-bootstrap-freeze` (PASS C2)
    - [x] Mutation probe: re-added `focus` option, 3 tests fail (including the frozen test); restored, 63 pass.

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (conductor).
  - [ ] Final gate step 2: run/verify branch CI on that PR (conductor).
  - [ ] Final gate step 3: remove `BRANCH.md`, push, merge (conductor).
