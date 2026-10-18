# Feature: BR-83 — Prove consumer boundaries before skipping work

## Objective
- [ ] Omit consumer integration/deployment only when qualified package contracts and unchanged installed application tuples prove it unnecessary.
- [ ] Branch `feat/ci-consumer-contracts`, step 8 of nine; train order BR-83 → BR-84; dependencies: BR-82 merged; BR-80 qualified candidates and BR-81 required deterministic integration.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-consumer-contracts`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-consumer-contracts` or `ENV=e2e-ci-consumer-contracts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9415, UI_PORT=5615, MAILDEV_UI_PORT=1515; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/69-BRANCH_feat-ci-consumer-contracts.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/compatibility-classifier.mjs`
  - [ ] `scripts/ci/compatibility-classifier.test.mjs`
  - [ ] `scripts/ci/consumer-contracts.mjs`
  - [ ] `scripts/ci/consumer-contracts.test.mjs`
  - [ ] `scripts/ci/installed-tuple.mjs`
  - [ ] `scripts/ci/installed-tuple.test.mjs`
  - [ ] `scripts/ci/consumer-boundaries.json`
  - [ ] `scripts/ci/publishable-classification.test.mjs`
  - [ ] `scripts/ci/publishable-ci-wiring.test.mjs`
  - [ ] `scripts/check-ci-version-filters.sh`
  - [ ] `api/package.json`
  - [ ] `ui/package.json`
  - [ ] `apps/auth-idp/package.json`
  - [ ] `apps/llm-gateway/package.json`
  - [ ] `packages/comments/package.json`
  - [ ] `packages/cluster-mesh/package.json`
  - [ ] `package-lock.json`
  - [ ] `api/Dockerfile`
  - [ ] `ui/Dockerfile`
  - [ ] `api/tests/contracts/comments-candidate.test.ts`
  - [ ] `apps/auth-idp/tests/cluster-candidate.test.ts`
  - [ ] `apps/llm-gateway/tests/cluster-candidate.test.ts`
  - [ ] `api/tests/contracts/cluster-candidate.test.ts`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR83-EX1; `Makefile` under BR83-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR83-EX1 — Planned workflow exception: extend `changes`, `enforce-package-bump`, compatibility classification, candidate-first consumer contracts, immutable tuple verification, missing owning validations, and the complete verdict. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR83-EX2 — Planned Makefile exception: add classifier/contract/tuple test targets and isolated consumer install/build contexts; retain version-bump and image hash/filter guards. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

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
- [ ] **Lot 1 — Consumer graph and candidate-owned contracts**
  - [ ] Create the named classifier/contracts scripts and tests plus `consumer-boundaries.json` (new); start comments → API, then cluster-mesh → API/IdP/gateway, retaining comments → cluster peer qualification.
  - [ ] Create the four named consumer-owned candidate tests (new); contracts consume BR-80 qualified tarballs and verify public exports, wire shape, auth/storage/streaming behavior as relevant, not just semver declarations.
  - [ ] Re-inventory all 43 study components and dynamic/protocol/configuration edges; wire existing missing owning validations before any affected fast path. Include `test-pkg-chat-core`, gateway-host `test-llm-gateway-process`, and real API integration for ubo-contracts; a delegated or absent test script is not a passing package test.
  - [ ] Lot gate: new `make test-ci-compatibility test-ci-consumer-contracts ENV=test-ci-consumer-contracts`; run the four named test files in isolated candidate installations and retain all newly wired validation receipts.
- [ ] **Lot 2 — Immutable installed tuples and conservative selection**
  - [ ] Add `installed-tuple.mjs` and its test; resolve isolated immutable dependency closures and Docker inputs. Adjust only the listed application/package manifests, root lock, and Dockerfiles; do not trust root workspaces, `file:` links, or numeric ranges as proof.
  - [ ] Update classification/wiring tests and the image-filter guard for internal fix, additive, breaking, explicit adoption, root-lock/toolchain, runtime/security, UI-only, and shared AuthProviderGlyph changes; unknown/missing evidence selects full blocking integration.
  - [ ] Preserve mandatory bumps for changed published sources; candidates qualify before contracts, tuple check, verdict, and publication. Skip library-only deployment only when both applications' installed tuple/digest evidence permits it.
  - [ ] Lot gate: new `make test-ci-installed-tuple ENV=test-ci-consumer-contracts`; `make test-publishable-manifests check-ci-version-filters ENV=test-ci-consumer-contracts`; real PR/main cases prove selected jobs and unchanged app digests, including a deliberate behavioral break that must select integration.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Inspect real package-only, UI-only, shared-asset, and upgrade receipts; UI changes still deploy UI, shared auth-ui assets still exercise UI plus IdP and both images, and adopted upgrades still run complete deterministic consumers.
  - [ ] Budget to measure: per-case/per-event elapsed savings and fraction avoiding full product qualification, with denominator and added contract/validation cost. The 95% adoption target is not a measured rate; acceptance requires identical installed tuples/digests for every omitted consumer.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: disable the affected boundary fast path and route it to full deterministic integration; restore the previous qualified installed tuple and conservative change classification without weakening version or digest guards.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-consumer-contracts` before each commit; end isolated service lots with `make down ENV=test-ci-consumer-contracts` and `make down ENV=e2e-ci-consumer-contracts`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
