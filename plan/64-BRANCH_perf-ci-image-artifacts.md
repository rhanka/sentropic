# Feature: BR-64 — Build and transfer fewer image bytes

## Objective
- [ ] Cache stable tool layers and transport source-correct production artifacts by exact digest.
- [ ] Branch `perf/ci-image-artifacts`, step 3 of nine; train order 64 → BR-65; dependencies: BR-63 merged; BR-62 timing and BR-63 prepared closures.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-image-artifacts`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-image-artifacts` or `ENV=e2e-ci-image-artifacts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9320, UI_PORT=5520, MAILDEV_UI_PORT=1420; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/64-BRANCH_perf-ci-image-artifacts.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `api/Dockerfile`
  - [ ] `ui/Dockerfile`
  - [ ] `e2e/Dockerfile`
  - [ ] `scripts/test-api-tooling.sh`
  - [ ] `scripts/check-ci-version-filters.sh`
  - [ ] `scripts/ci/image-receipt.mjs`
  - [ ] `scripts/ci/image-receipt.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR64-EX1; `Makefile` under BR64-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR64-EX1 — Planned workflow exception: change `build-api-image`, `build-api-tool-image`, `build-ui`, `build-e2e`, and their image consumers in `security-container` and `test-smoke-restore`. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR64-EX2 — Planned Makefile exception: change image cache/build/save/load targets and `API_TOOL_VERSION`; add `test-ci-image-receipts`; remove UI forced `--no-cache` without weakening hash inputs. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.

## AI Flaky tests
- [ ] Deterministic checks are blocking. Any retained live-provider exception needs non-systematic same-commit/same-command success, failure signature, impact analysis, and explicit owner sign-off; never increase timeouts.

## Orchestration Mode (AI-selected)
- [ ] **Multi-branch** — This is one independently reviewed/qualified branch of the serialized nine-branch train.
- [ ] Rationale: preserve branch-level rollback and serialize shared workflow/Makefile edits; internal CI lanes may run concurrently.

## UAT Management (in orchestration context)
- [ ] Run the lot UAT on the exact pushed qualification SHA; record immutable source/target SHAs for any integrated qualification workspace.
- [ ] Use isolated automated environments; web/Chrome/VSCode UAT below is limited to affected behavior; no root-dev automated testing.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Verify branch mechanically with harness; confirm prerequisite receipts and conductor registration/import before implementation; inventory the actual files and existing assertions at the new base.
  - [ ] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities.
  - [ ] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
- [ ] **Lot 1 — Build inputs and persistent cache**
  - [ ] Inventory exact Dockerfile/toolchain/architecture/lock/source/build-argument and embedded-asset inputs; keep the complete source-dependent payload key while separating stable tooling layers.
  - [ ] Configure explicit BuildKit cache import/export scopes for API runtime, tools, UI profiles, and E2E; source-only, lock, toolchain, profile, and cold misses must invalidate the correct outputs.
  - [ ] Update `scripts/test-api-tooling.sh` and `scripts/check-ci-version-filters.sh`; lot gate: `make test-ci-api-tooling check-ci-version-filters ENV=test-ci-image-artifacts`.
- [ ] **Lot 2 — Digest-addressed artifact transport**
  - [ ] Add `image-receipt.mjs` and `image-receipt.test.mjs` (new): source/workflow/input digest, immutable artifact digest, cache identity, and producer/consumer verification; reject wrong/missing/stale receipts.
  - [ ] Keep PR transport credential-free through integrity-checked artifacts; include export/load/compression and candidate upload in timing. A small non-browser test must not fetch a large browser/compiler toolbox unnecessarily.
  - [ ] Lot gate: `make test-ci-image-receipts test-ci-api-runtime test-ci-api-tag-guard test-ci-api-tool-runtime ENV=test-ci-image-artifacts` against freshly built artifacts; retain npm-absent runtime and tag-collision assertions.
  - [ ] Real warm/cold runs exercise all four image producers, scanners, and restore consumers; match the consumed digest to the producer receipt.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Verify actual production-image smoke/limits, served IdP screens, and restore still consume the qualified image; UI profile output includes its expected embedded files.
  - [ ] Budget to measure: longest complete image-readiness branch ≤180s warm / 210s cold including embedded prerequisites and transfer; API-case UI branch ≤120/150s. Do not substitute the PR's 495s UI job for the main API-case 138s observation.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore previous build/transport recipes and invalidate only this branch's cache scopes; rebuild and verify fresh artifact receipts, preserving digest and production-runtime checks.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-image-artifacts` before each commit; end isolated service lots with `make down ENV=test-ci-image-artifacts` and `make down ENV=e2e-ci-image-artifacts`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
