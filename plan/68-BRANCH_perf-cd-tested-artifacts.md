# Feature: BR-68 — Complete delivery on the tested bytes

## Objective
- [ ] Publish tested image digests and package archives, then prove preproduction readiness and all selected release receipts.
- [ ] Branch `perf/cd-tested-artifacts`, step 7 of nine; train order 68 → BR-69; dependencies: BR-64 image receipts, BR-65 complete join, BR-66 candidates, and BR-67 deterministic qualification merged.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/cd-tested-artifacts`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-cd-tested-artifacts` or `ENV=e2e-cd-tested-artifacts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9340, UI_PORT=5540, MAILDEV_UI_PORT=1440; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/68-BRANCH_perf-cd-tested-artifacts.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/publish-api-image.sh`
  - [ ] `scripts/test-api-tag-guard.sh`
  - [ ] `scripts/ci/publishable-manifests.mjs`
  - [ ] `scripts/ci/publishable-pack.test.mjs`
  - [ ] `scripts/ci/qualify-published-install.mjs`
  - [ ] `scripts/ci/qualify-published-install.test.mjs`
  - [ ] `scripts/ci/release-receipt.mjs`
  - [ ] `scripts/ci/release-receipt.test.mjs`
  - [ ] `packages/cluster-mesh/packaging.mk`
  - [ ] `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs`
  - [ ] `packages/cluster-mesh/tests/packaging/lock-integrity.spec.ts`
  - [ ] `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `Makefile` except BR68-EX2; `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR68-EX1; `Makefile` under BR68-EX2.
  - [ ] `deploy/k8s/overlays/preprod/kustomization.yaml`, `deploy/k8s/overlays/preprod/patch-api-config.yaml`, and `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml` under BR68-EX3.
- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR68-EX1 — Planned workflow exception: join `publish-api-image`, `publish-ui-image`, every selected package publisher, `verify-train-lock-integrity`, and `deploy-preprod` to complete qualification and release-result receipts. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR68-EX2 — Planned Makefile exception: promote image metadata without rebuilding/reloading layers, publish prequalified tarballs, and instrument `k8s-deploy-preprod`; add release-receipt tests. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] BR68-EX3 — Change only preproduction digest pins/readiness configuration justified by measured startup spans; impact: preproduction rollout; rollback: previous qualified immutable tuple and prior health settings. Production overlays remain forbidden.
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
- [ ] **Lot 1 — Qualified candidate promotion and package train**
  - [ ] Main builds upload non-deployment candidate layers inside BR-64 image budgets; all consumers verify the same digest. PRs retain artifact transport without registry credentials.
  - [ ] Add `release-receipt.mjs` and its test: reject missing/failed/cancelled/skipped required checks, wrong source/digest, missing publication, tag collision, mismatched registry integrity/provenance, and stale receipt reuse.
  - [ ] Update the named image/manifest/qualification scripts and tests; every publisher waits for the complete verdict, publishes exact tested bytes, and retains clean registry qualification.
  - [ ] Preserve new-version mesh → gateway → cluster ordering; run unrelated publishers and train-lock verification concurrently only after their actual prerequisites. Record version-visible receipts rather than repacking or repeating registry checks.
  - [ ] Lot gate: new `make test-ci-release-receipts ENV=test-cd-tested-artifacts`; `make test-ci-api-tag-guard test-publishable-manifests test-qualify-published-install ENV=test-cd-tested-artifacts`; run both named lock-integrity tests through the packaging target.
- [ ] **Lot 2 — Actual readiness and complete delivery**
  - [ ] Measure pod scheduling, pull, init/migration, shutdown, and readiness before tuning; existing rollouts already start together, so parallel status commands alone cannot claim the 41-second saving.
  - [ ] Preserve image-existence, npm-absent runtime, and health/failure checks; UI-only merges retain the API digest; shared auth-ui/IdP assets qualify and deliver both consumers.
  - [ ] Lot gate: a real main release with fresh selected package versions, registry/provenance/install receipts, `make -f packages/cluster-mesh/packaging.mk check-train-lock-integrity ENV=test-cd-tested-artifacts`, and real preproduction rollout/readiness; no manual bootstrap used as steady-state evidence.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Verify web and served IdP against the deployed immutable tuple; distinguish qualified PR, published images, preproduction readiness, and every selected package receipt. Exercise failed-promotion and rollback fixtures.
  - [ ] Budget to measure: image promotion ≤40s after candidate upload; full selected fresh npm train ≤195s; preproduction ≤75s versus 116s. Measure all from actual prerequisites and include queue time in complete event endpoints; already-published skips do not qualify the fresh-version budget.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the previous qualified preproduction image tuple and prior promotion/deploy recipes; issue a corrective npm version for released package defects, never overwrite published bytes or bypass artifact verification.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-cd-tested-artifacts` before each commit; end isolated service lots with `make down ENV=test-cd-tested-artifacts` and `make down ENV=e2e-cd-tested-artifacts`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
