# Feature: BR-83 — Prove consumer boundaries before skipping work

## Objective
- [ ] Omit consumer integration/deployment only when qualified package contracts and unchanged installed application tuples prove it unnecessary.
- [ ] Branch `feat/ci-consumer-contracts`, step 8 of nine; train order BR-83 → BR-84; dependencies: BR-82 merged (`e4328ae5c`, PR #918); BR-80 qualified candidates and BR-81 required deterministic integration.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-consumer-contracts`; rebased on main at predecessor merge (`e4328ae5c`); one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; Docker through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh` (3 parallel slots, one slot per command, never nested); tests on `ENV=test-ci-consumer-contracts` or `ENV=e2e-ci-consumer-contracts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9415, UI_PORT=5615, MAILDEV_UI_PORT=1515; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/69-BRANCH_feat-ci-consumer-contracts.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/ci/compatibility-classifier.mjs` (new deliverable)
  - [ ] `scripts/ci/compatibility-classifier.test.mjs` (new deliverable)
  - [ ] `scripts/ci/consumer-contracts.mjs` (new deliverable)
  - [ ] `scripts/ci/consumer-contracts.test.mjs` (new deliverable)
  - [ ] `scripts/ci/installed-tuple.mjs` (new deliverable)
  - [ ] `scripts/ci/installed-tuple.test.mjs` (new deliverable)
  - [ ] `scripts/ci/consumer-boundaries.json` (new deliverable)
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
  - [ ] `api/tests/contracts/comments-candidate.test.ts` (new deliverable)
  - [ ] `apps/auth-idp/tests/cluster-candidate.test.ts` (new deliverable)
  - [ ] `apps/llm-gateway/tests/cluster-candidate.test.ts` (new deliverable)
  - [ ] `api/tests/contracts/cluster-candidate.test.ts` (new deliverable)
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR83-EX1
  - [ ] `Makefile` under BR83-EX2
  - [ ] `apps/auth-idp/tsconfig.json` under BR83-EX3 (include the new `tests/` contract only)
  - [ ] `e2e/tests/08-chat-workspace-switch.spec.ts` under BR83-EX4 (the repeatedly failing session-navigation test only)
- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] BR83-EX4 — Bounded E2E fix: run `42128147592` job `127601046976` repeated the hidden `RESP-ALPHA-ONE` failure. Local shard-2 observations show failed clicks on an unregistered row (`tabindex=-1`); successful clicks use the registered roving tab stop (`tabindex=0`). Focus the row and require that readiness state within 2 seconds before clicking; retain all existing navigation/message assertions, timeouts and zero retries. Temporary logging removed. Scoped Make shard 2: 16 expected/executed, zero skipped/retries, all green. Impact: this test only. Rollback: restore this test from `1115dd372`.
- [x] PR #921 dispatch fix: the consumer verifier failed in the shell before Node when GitHub supplied multiline JSON. Export both JSON inputs unchanged and pass their environment names to Docker. The original failing reproduction now returns `ok: true`, full selection, and no omitted consumers; classifier/contract/tuple fixtures pass 18 + 21 + 10 tests.
- [x] PR #921 contract fix: run `42093229341` attempt 1 first errors are IdP TS2307 and API contract imports of a CI guard absent from the API images. Read qualified archive manifests with the existing `tar` binary instead. Local toolbox static checks pass; all four candidate contracts pass with real packed manifests (16/16). Preserve the 26 commits through `6e4bb39f2`.
- [x] E2E evidence before edits: main `1115dd372` run `42072389269`, job `127406821196`, passes 16/16; branch run `42093229341`, job `127479714634`, fails `08-chat-workspace-switch.spec.ts:208` with `RESP-ALPHA-ONE` present but hidden and the agents list visible. Earlier main `c3d5b2f17` run `41981165023`, job `127092947062`, has the identical locator, hidden result, and line 208 failure. UI/chat sources, that test, and UI lockfile have no diff from that main through this branch. This is a navigation failure requiring diagnosis, not a consumer-contract assertion or proof that a timeout should change.
- [ ] Track import belongs to the designated conductor; `.track/**` remains forbidden here. Import this branch plan, deliverables and final receipt during the next single-writer sync.
- [ ] Docker slot hygiene: every Docker-using Make command goes through `.tmp/packets/docker-slot.sh` (one of 3 parallel slots, one slot per command, never nested); keep distinct ENV and ports per lane; end service lots with `make down-volumes`.
- [ ] BR83-EX1 — Planned workflow exception: extend `changes`, `enforce-package-bump`, compatibility classification, candidate-first consumer contracts, immutable tuple verification, missing owning validations, and the complete verdict. Reason: no consumer work may be skipped without a qualified contract plus an unchanged installed tuple, and the selection must be visible in CI dispatch. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR83-EX2 — Planned Makefile exception: add classifier/contract/tuple test targets and isolated consumer install/build contexts; retain version-bump and image hash/filter guards. Reason: the new gates need named CI entry points without weakening existing guards. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] BR83-EX3 — Bounded typecheck exception: include `tests/` in `apps/auth-idp/tsconfig.json` so the new `cluster-candidate` contract participates in `typecheck-idp`; no source change. Reason: the IdP composition previously had no tests directory, so the contract would otherwise run without static coverage. Impact: one include line; `typecheck-idp` additionally checks the new test file. Rollback: revert the include line (the test still runs under vitest via `test-idp-candidate`).
- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [ ] Baseline receipts: main merge run `41939652646` attempt 1 (head `4d7517d94`, pre-BR-81): wall 1049s. Post-BR-81 merge run `41981165023` attempt 1 (head `c3d5b2f17`, 2026-11-05): wall 815s, FAILED — `test-e2e` shards 2+4 failed, `deploy-preprod` registry-assert failed (exit 2, assert step, both publish jobs skipped so no images to assert), `ci-gate` failed as a consequence. First post-BR-82 main run `42028095109` attempt 1 (head `e4328ae5c`, 2026-11-05T12:33Z→12:46Z): wall 779s, FAILED — `test-e2e (6)` UI flake (06-usecase textarea `toBeEnabled` timeout, same family as the base shards 2+4 flakes, unrelated to BR-82/BR-83), then fail-closed cascade: both publish jobs skipped on the failed needs chain, `release-receipts` FAIL (4) (`publish-api-image`/`publish-ui-image` concluded skipped, missing publications `sentropic-api@186ef5`/`sentropic-ui@434fe5`), `ci-gate` failed as a consequence; 109 jobs: 76 success, 30 skipped, 3 failed. The FAIL receipt artifact is retained (`release-receipt.json` with the four problems). No `pack: candidate|fresh` publisher receipts and no preprod rollout/readiness spans exist yet on main: to-measure until a green post-BR-82 main run completes (see `.tmp/rv/br83.md`).

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
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/worktrees/ci-consumer-contracts` on `feat/ci-consumer-contracts` from `origin/main` (`e4328ae5c`, BR-82 merged); verify with `git branch --show-current`.
  - [x] Rebased onto current `origin/main` (`1115dd372`, PR #920, release-receipt skipped-publishers hotfix) after the gateway/IdP suites and installed-tuple gates went green; `BRANCH.md` kept branch content at the replay conflict, `ci.yml` auto-merged (disjoint regions).
  - [x] Capture Makefile targets needed for debug/testing (`test-publishable-manifests`, `test-ci-release-receipts`, `check-ci-version-filters`, `test-ci-package-candidate`, `test-ci-dag`, `test-ci-expected-results`).
  - [x] Define environment mapping (`test-ci-consumer-contracts`, `e2e-ci-consumer-contracts`) and ports (9415/5615/1515) for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last; Docker via `docker-slot.sh`, one slot per command, never nested.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare BR83-EX1/BR83-EX2 before touching conditional paths.
  - [x] Verify branch mechanically with harness (`harness check branch`); inventory actual files at the new base: `compatibility-classifier.*`, `consumer-contracts.*`, `installed-tuple.*`, `consumer-boundaries.json`, and the four named candidate tests do not exist yet (all are new deliverables); `publishable-classification.test.mjs`, `publishable-ci-wiring.test.mjs`, `check-ci-version-filters.sh`, `release-receipt.*` exist.
  - [x] Triage base-main failures before BR-83 measurements count: run `41981165023` attempt 1 failed `test-e2e (2)` + `test-e2e (4)` (pre-existing, same shards as the BR-82 report) and `deploy-preprod` (registry-assert exit 2 with both publish jobs skipped) with `ci-gate` as consequence; none touches consumer-contract code. First post-BR-82 run `42028095109` attempt 1 triaged: `test-e2e (6)` UI flake caused a fail-closed cascade (`release-receipts` FAIL (4), `ci-gate` failed); no BR-82 logic defect, no publisher `pack` receipts and no preprod spans yet — to-measure until a green post-BR-82 main run completes.
- [ ] **Lot 1 — Consumer graph and candidate-owned contracts**
  - [x] Write `scripts/ci/compatibility-classifier.test.mjs` first: internal fix, additive, breaking, explicit adoption, root-lock/toolchain, runtime/security, UI-only, shared-asset (AuthProviderGlyph), and unknown/missing-evidence cases (18/18 green in `test-ci-compatibility`).
  - [x] Add `scripts/ci/compatibility-classifier.mjs` to satisfy the tests.
  - [x] Write `scripts/ci/consumer-contracts.test.mjs` first: comments → API, cluster-mesh → API/IdP/gateway edges, candidate-tarball consumption, fail-closed on missing qualification (20/20 green in `test-ci-consumer-contracts`, incl. matrix-member matching).
  - [x] Add `scripts/ci/consumer-contracts.mjs` and `scripts/ci/consumer-boundaries.json` to satisfy the tests.
  - [ ] Create the four named consumer-owned candidate tests (new): `api/tests/contracts/comments-candidate.test.ts` (4/4 green), `api/tests/contracts/cluster-candidate.test.ts` (4/4 green), `apps/auth-idp/tests/cluster-candidate.test.ts` (4/4 green via `make test-idp-candidate ENV=test-ci-consumer-contracts` after restoring the worktree `.env` from root; the two earlier npm network failures in `prepare-node-workspace` were transient infra), `apps/llm-gateway/tests/cluster-candidate.test.ts` (4/4 green via `make test-llm-gateway-process SCOPE=tests/cluster-candidate.test.ts ENV=test-ci-consumer-contracts` after the same fix; first attempt never reached test code — `prepare-node-workspace` failed on `invalid tag` with `REGISTRY` unset); contracts consume BR-80 qualified tarballs (packed-manifest match when `*_CANDIDATE_TARBALL` is set) and verify public exports, wire shape, auth fail-closed, and relay behavior, not just semver declarations.
  - [x] Re-inventory all 43 study components (39 libraries + api/ui/auth-idp/llm-gateway host) and dynamic/protocol/configuration edges; wire existing missing owning validations before any affected fast path (`test-pkg-chat-core` retained in `validate-chat-core`, gateway-host `test-llm-gateway-process` wired into `validate-llm-gateway` under BR83-EX1, real API integration `api/tests/object-registry/object-type-registry.test.ts` for `ubo-contracts` recorded as the owning validation).
  - [ ] Lot gate: new `make test-ci-compatibility test-ci-consumer-contracts ENV=test-ci-consumer-contracts` (green); run the four named test files in isolated candidate installations and retain all newly wired validation receipts (4/4 green).
- [ ] **Lot 2 — Immutable installed tuples and conservative selection**
  - [x] Write `scripts/ci/installed-tuple.test.mjs` first: isolated immutable dependency closures, Docker input digests, `file:`-link/root-workspace rejection, numeric-range rejection (10/10 green, incl. app-nested lock precedence over hoisted copies).
  - [x] Add `scripts/ci/installed-tuple.mjs` to satisfy the tests; no manifest/lock/Dockerfile change needed (resolver reads existing files; workspace-version fallback keeps unqualified tuples comparable but never omission-proof).
  - [x] Update classification/wiring tests and the image-filter guard for every change kind (`packages/auth-ui/**` added to the `ui` filter, `packages/comments/**` to `cluster_mesh`, `packages/cluster-mesh/**` to `llm_gateway`); unknown/missing evidence selects full blocking integration. `check-ci-version-filters.sh` unchanged: additions only widen coverage, the superset assertion still holds.
  - [x] Preserve mandatory bumps for changed published sources; candidates qualify before contracts, tuple check, verdict, and publication. Skip library-only deployment only when both applications' installed tuple/digest evidence permits it (enforced by `verifyDispatch`: omission needs identical tuples with every linked dependency candidate-qualified).
  - [x] Lot gate: new `make test-ci-installed-tuple ENV=test-ci-consumer-contracts` (10/10 green); `make test-publishable-manifests check-ci-version-filters ENV=test-ci-consumer-contracts` (green, incl. 4 new wiring + 1 classification BR-83 tests); real PR case proven: this branch diff (base `e4328ae5c` → HEAD, global/api/package_candidates) classifies runtime-security → full with every required consumer selected and zero dispatch problems via `make consumer-contracts-verify`; deliberate behavioral break proven on the live workflow (comments 0.3.1 → 1.0.0): breaking → full, `fastPath` false, all required consumers selected; identical qualified tuples approve tuple-gated omission at unit level, identical unqualified tuples refuse it.
  - [ ] Pre-UAT static gate: `make typecheck-api lint-api typecheck-ui lint-ui typecheck-idp typecheck-idp-web typecheck-llm-gateway API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=test-ci-consumer-contracts` after the isolated dependency/lock changes, before Lot 3.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Inspect real package-only, UI-only, shared-asset, and upgrade receipts; UI changes still deploy UI, shared auth-ui assets still exercise UI plus IdP and both images, and adopted upgrades still run complete deterministic consumers.
  - [ ] Budget to measure: per-case/per-event elapsed savings and fraction avoiding full product qualification, with denominator and added contract/validation cost. The 95% adoption target is not a measured rate; acceptance requires identical installed tuples/digests for every omitted consumer.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: disable the affected boundary fast path and route it to full deterministic integration; restore the previous qualified installed tuple and conservative change classification without weakening version or digest guards.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the branch plan (`plan/69-BRANCH_feat-ci-consumer-contracts.md`) with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api typecheck-ui lint-ui typecheck-idp typecheck-idp-web typecheck-llm-gateway API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=test-ci-consumer-contracts` and all classifier/contract/tuple fixture gates.
  - [ ] Build: `make build-api build-ui-image API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=e2e-ci-consumer-contracts` for cases selecting application changes; compare installed tuples and Docker input digests, including UI-only and shared-asset cases, before accepting any omitted build.
  - [ ] API regression: `make test-api API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=test-ci-consumer-contracts` for breaking, unknown, and adopted-upgrade cases; all four named candidate contracts plus `make test-llm-gateway-process API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=test-ci-consumer-contracts` remain required; prove unchanged tuples for every omitted consumer.
  - [ ] UI regression: `make test-ui API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=test-ci-consumer-contracts` for selected UI/lock/shared-asset cases; retain UI and IdP checks and both image receipts where the shared asset requires them.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=e2e-ci-consumer-contracts` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9415 UI_PORT=5615 MAILDEV_UI_PORT=1515 ENV=e2e-ci-consumer-contracts` for full-integration cases; the deliberate break must select these lanes. A skipped case needs exact candidate-contract and unchanged-tuple evidence; daily live results stay separate.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-consumer-contracts` before each commit; end isolated service lots with `make down-volumes ENV=test-ci-consumer-contracts` and `make down-volumes ENV=e2e-ci-consumer-contracts`.
  - [ ] Create/update the PR using `BRANCH.md` text as PR body; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
