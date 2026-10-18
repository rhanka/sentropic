# Feature: BR-80 — One package candidate and independent qualifications

## Objective
- [ ] Produce each immutable candidate once and preserve storage, crash, installed-consumer, and peer assertions in isolated parallel lanes.
- [ ] Branch `perf/ci-package-candidates`, step 5 of nine; train order BR-80 → BR-81; dependencies: BR-79 merged for shared-file order; BR-77 closures and BR-78 receipt contract.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-package-candidates`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-package-candidates` or `ENV=e2e-ci-package-candidates`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9400, UI_PORT=5600, MAILDEV_UI_PORT=1500; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/66-BRANCH_perf-ci-package-candidates.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `packages/cluster-mesh/tests/storage/cold-workspace.sh`
  - [ ] `packages/cluster-mesh/tests/storage/postgres.mk`
  - [ ] `packages/cluster-mesh/packaging.mk`
  - [ ] `packages/cluster-mesh/tests/packaging/prepare.sh`
  - [ ] `scripts/ci/publishable-manifests.mjs`
  - [ ] `scripts/ci/publishable-manifests.test.mjs`
  - [ ] `scripts/ci/publishable-pack.test.mjs`
  - [ ] `scripts/ci/qualify-published-install.mjs`
  - [ ] `scripts/ci/qualify-published-install.test.mjs`
  - [ ] `scripts/ci/package-candidate.mjs`
  - [ ] `scripts/ci/package-candidate.test.mjs`
  - [ ] `scripts/ci/package-qualification-dag.test.mjs`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR80-EX1; `Makefile` under BR80-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR80-EX1 — Planned workflow exception: refactor `validate-cluster-mesh`, `validate-publishable-manifests`, `validate-llm-mesh`, and `validate-llm-gateway` around shared immutable candidate receipts. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR80-EX2 — Planned Makefile exception: change `cluster-mesh-workspace`, `pack-cluster-mesh`, `manifest_guard_pack`, and `pack-candidate-siblings`; add candidate/DAG fixture test targets without shared mutable state. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

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
- [ ] **Lot 1 — Candidate closure and guard ownership**
  - [ ] Add `package-candidate.mjs` and `package-candidate.test.mjs` (new): build the topological sibling closure and pack once per source/tool tuple; hash each tarball and require all selected sibling receipts.
  - [ ] Update the named manifest/pack/install scripts and tests: wrong SHA/hash, absent archive/sibling, registry failure, and a modified packed manifest must fail; clean consumers receive tarballs, never source `node_modules`.
  - [ ] Lot gate: new `make test-ci-package-candidate ENV=test-ci-package-candidates` plus `make test-publishable-manifests test-qualify-published-install ENV=test-ci-package-candidates`.
- [ ] **Lot 2 — Independent qualification lanes**
  - [ ] Refactor the four named cluster preparation/Make files; separate static/source, PostgreSQL conformance, comments storage, crash recovery, candidate packing, and installed lanes; each mutating lane owns its workspace/database/ports.
  - [ ] Preserve existing `postgres-crashes.spec.ts`, `installed-major-upgrade.mjs`, `installed-bare.mjs`, and all packaging suite membership; maintain seed → crash/restart → verify inside each crash fixture.
  - [ ] Add `package-qualification-dag.test.mjs` (new): no installed check before packing, no second candidate build, distinct mutable fixture roots, lazy bare/selected-peer/latest-in-range/global-consumer cases retained.
  - [ ] Lot gate: new `make test-ci-package-qualification-dag ENV=test-ci-package-candidates`; `make lint-cluster-mesh typecheck-cluster-mesh test-cluster-mesh ENV=test-ci-package-candidates`; run `cluster-mesh-pg-test`, `cluster-mesh-comments-test`, `cluster-mesh-pg-crash-test`, `cluster-mesh-comments-installed`, and `cluster-mesh-pg-major-upgrade` through `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk` with distinct `ENV=test-*` last and the exact candidate tarball; run `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-ci-package-candidates` and `qualify-published-install` with candidate/sibling receipts.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Review installed package exports, optional-peer behavior, clean install, retained cursors, and PostgreSQL recovery receipts; no product UI change.
  - [ ] Budget to measure on real warm/cold qualification: complete cluster branch ≤210s versus 664s; common manifest guard ≤75s versus 125s. Account for preparation, pack, transfer, and longest installed lane; one candidate per tuple is observable.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the prior isolated preparation and serialized qualification recipes, discard only affected candidate receipts, and rerun all preserved storage/installed assertions.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-package-candidates` before each commit; end isolated service lots with `make down ENV=test-ci-package-candidates` and `make down ENV=e2e-ci-package-candidates`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
