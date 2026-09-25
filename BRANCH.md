# Feature: Bootstrap publish requires an explicit target

## Objective
Remove the `all` option of the `ci.yml` `bootstrap_publish_target` dispatch input so a bootstrap publication always targets exactly one declared package (frozen packages must not be published by any path).

## Scope / Guardrails
- Scope limited to the `ci.yml` bootstrap input and bootstrap job step conditions, the CI wiring test, and one line of `rules/workflow.md`.
- Make-only workflow, no direct Docker commands.
- No publish, no workflow dispatch, no trusted publisher change, no branch protection change, nothing under `packages/**`. No push.
- In every `make` command, `ENV=<env>` must be passed as the last argument (`ENV=test-bootstrap-explicit-target`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` (BRBOOT-EX1)
  - `rules/workflow.md` (BRBOOT-EX2)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge` BRBOOT-EX1: `.github/workflows/ci.yml`, limited to the `bootstrap_publish_target` input (remove `all`, description) and the `bootstrap-publish` job (step conditions + a first target-validation step). Reason: `all` would publish, with NPM_TOKEN and without provenance, every bootstrap target whose version is absent from npm, including owner-frozen auth-hono 0.15.2, build-cli 0.3.0 and focus 0.6.0. Impact: bootstrap dispatch needs one explicit target; steady-state OIDC publishers unchanged. Rollback: revert the commit.
- [x] `acknowledge` BRBOOT-EX2: `rules/workflow.md` Package Publication, one line stating bootstrap requires an explicit target. Reason: keep the rule aligned with the workflow. Impact: documentation only. Rollback: revert the line.
- [ ] `attention`: `scripts/ci/publishable-manifests.mjs` still accepts `bootstrapTarget === 'all'` (it only adds BLOCK checks, it never publishes). Left unchanged as the most conservative option (outside brief scope); a follow-up may remove the dead `all` branch and its classification test.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single small CI lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/bootstrap-explicit-target` on branch `ci/bootstrap-explicit-target`.
  - [x] Declare BRBOOT-EX1 and BRBOOT-EX2.

- [ ] **Lot 1 — Explicit bootstrap target**
  - [ ] Remove `all` from the `bootstrap_publish_target` options and update the input description.
  - [ ] Remove every `|| inputs.bootstrap_publish_target == 'all'` from bootstrap step conditions (publish + qualification steps).
  - [ ] Add a first `bootstrap-publish` step failing when the target is `all` or not a declared option.
  - [ ] Extend `scripts/ci/publishable-ci-wiring.test.mjs`: no `all` option, no `'all'` condition, each bootstrap step condition matches exactly one declared option, guard step first.
  - [ ] `rules/workflow.md`: one line stating bootstrap requires an explicit target.
  - [ ] Lot gate:
    - [ ] `make test-publishable-manifests ENV=test-bootstrap-explicit-target`
    - [ ] `make check-ci-version-filters ENV=test-bootstrap-explicit-target`
    - [ ] `make scope-check ENV=test-bootstrap-explicit-target`
