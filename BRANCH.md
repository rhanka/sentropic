# Feature: BR-82 — Complete delivery on the tested bytes

## Objective
- [ ] Publish tested image digests and package archives, then prove preproduction readiness and all selected release receipts.
- [ ] Branch `perf/cd-tested-artifacts`, step 7 of nine; train order BR-82 → BR-83; dependencies: BR-78 image receipts, BR-79 complete join, BR-80 candidates, BR-81 deterministic qualification merged (main `c3d5b2f17`).

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/cd-tested-artifacts`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; Docker through `.tmp/packets/docker-slot.sh` (3 parallel slots, one slot per command, never nested); tests on `ENV=test-cd-tested-artifacts` or `ENV=e2e-cd-tested-artifacts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9410, UI_PORT=5610, MAILDEV_UI_PORT=1510; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md`; `plan/68-BRANCH_perf-cd-tested-artifacts.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `scripts/publish-api-image.sh`
  - [ ] `scripts/test-api-tag-guard.sh`
  - [ ] `scripts/ci/publishable-manifests.mjs`
  - [ ] `scripts/ci/publishable-pack.test.mjs`
  - [ ] `scripts/ci/qualify-published-install.mjs`
  - [ ] `scripts/ci/qualify-published-install.test.mjs`
  - [ ] `scripts/ci/release-receipt.mjs` (new deliverable)
  - [ ] `scripts/ci/release-receipt.test.mjs` (new deliverable)
  - [ ] `packages/cluster-mesh/packaging.mk`
  - [ ] `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs`
  - [ ] `packages/cluster-mesh/tests/packaging/lock-integrity.spec.ts`
  - [ ] `packages/cluster-mesh/tests/packaging/lock-integrity-registry.spec.ts`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR82-EX1
  - [ ] `Makefile` under BR82-EX2
  - [ ] `deploy/k8s/overlays/preprod/kustomization.yaml`, `deploy/k8s/overlays/preprod/patch-api-config.yaml`, and `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml` under BR82-EX3
- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] Track import belongs to the designated conductor; `.track/**` remains forbidden here. Import this branch plan, deliverables and final receipt during the next single-writer sync.
- [ ] Docker slot hygiene: every Docker-using Make command goes through `.tmp/packets/docker-slot.sh` (one of 3 parallel slots, one slot per command, never nested); keep distinct ENV and ports per lane; end service lots with `make down-volumes`.
- [ ] BR82-EX1 — Planned workflow exception: join `publish-api-image`, `publish-ui-image`, every selected package publisher, `verify-train-lock-integrity`, and `deploy-preprod` to complete qualification and release-receipt results. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR82-EX2 — Planned Makefile exception: promote image metadata without rebuilding/reloading layers, publish prequalified tarballs, and instrument `k8s-deploy-preprod`; add release-receipt tests. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.
- [ ] BR82-EX3 — Change only preproduction digest pins/readiness configuration justified by measured startup spans; impact: preproduction rollout; rollback: previous qualified immutable tuple and prior health settings. Production overlays remain forbidden.
- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [ ] Baseline receipts: main merge run `41939652646` attempt 1 (head `4d7517d94`, pre-BR-81): wall 1049s; `publish-api-image` 93s, `publish-ui-image` 76s, `deploy-preprod` 71s, `publish-artifacts` 47s, `ci-gate` 19s. Post-BR-81 merge run `41981165023` attempt 1 (head `c3d5b2f17`, 2026-11-05): wall 815s, FAILED — `test-e2e` shards 2+4 failed, `deploy-preprod` registry-assert failed with both publish jobs skipped, `ci-gate` failed. Post-merge "after" measurement for BR-82 (promotion ≤40s, npm train ≤195s, preprod ≤75s) is BR-83/train handoff work.
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
  - [x] Create isolated worktree `tmp/worktrees/cd-tested-artifacts` on `perf/cd-tested-artifacts` from `origin/main` (`c3d5b2f17`, BR-81 merged).
  - [x] Capture Makefile targets needed for debug/testing (`make help` scoped to CD lots).
  - [x] Define environment mapping (`test-cd-tested-artifacts`, `e2e-cd-tested-artifacts`) and ports (9410/5610/1510) for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last; Docker via `docker-slot.sh`, one slot per command, never nested.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare BR82-EX1/EX2/EX3 before touching conditional paths.
  - [x] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities (main merge run `41939652646` attempt 1, head `4d7517d94`: wall 1049s; `publish-api-image` 93s, `publish-ui-image` 76s, `deploy-preprod` 71s, `ci-gate` 19s).
- [ ] **Lot 1 — Qualified candidate promotion and package train**
  - [x] Write `scripts/ci/release-receipt.test.mjs` first: reject missing/failed/cancelled/skipped required checks, wrong source/digest, missing publication, tag collision, mismatched registry integrity/provenance, stale receipt reuse.
  - [x] Add `scripts/ci/release-receipt.mjs` to satisfy the tests.
  - [x] Main builds upload non-deployment candidate layers inside BR-78 image budgets; all consumers verify the same digest; PRs retain artifact transport without registry credentials (verified on main: transport artifacts + image-receipt verify; no change needed).
  - [x] Update the named image/manifest/qualification scripts and tests; every publisher waits for the complete verdict, publishes exact tested bytes, and retains clean registry qualification (`publish-api-image` now joins `test-api-ai`; train publishers reuse verified candidates with `pack: candidate|fresh` receipts; npm non-train publishers keep pinned validator wiring, joined at the chain level by the Lot 2 release-receipts gate).
  - [x] Preserve new-version mesh → gateway → cluster ordering; run unrelated publishers and train-lock verification concurrently only after their actual prerequisites. Record version-visible receipts rather than repacking or repeating registry checks (train ordering and concurrency unchanged; publish receipts now record the pack source).
  - [x] Lot gate (measured 2026-11-05 on head `c42652a89`, ENV=test-cd-tested-artifacts, via docker-slot.sh):
    - [x] `make test-ci-release-receipts`: 27/27 pass.
    - [x] `make test-publishable-manifests`: 114/114 pass; `make test-ci-api-tag-guard test-qualify-published-install`: pass (qualify 19/19).
    - [x] `make -f packages/cluster-mesh/packaging.mk check-train-lock-integrity`: pass (llm-mesh@0.33.0, llm-gateway@0.22.4 registry integrity matches the committed lock). The two named vitest specs (`lock-integrity.spec.ts`, `lock-integrity-registry.spec.ts`) are unchanged by this branch and run in CI via `test-lazy-package`.
- [ ] **Lot 2 — Actual readiness and complete delivery** (pending post-merge: publish jobs run only on `refs/heads/main`)
  - [ ] Measure pod scheduling, pull, init/migration, shutdown, and readiness before tuning; existing rollouts already start together, so parallel status commands alone cannot claim the 41-second saving.
  - [ ] Preserve image-existence, npm-absent runtime, and health/failure checks; UI-only merges retain the API digest; shared auth-ui/IdP assets qualify and deliver both consumers.
  - [ ] Lot gate: a real main release with fresh selected package versions, registry/provenance/install receipts, `make -f packages/cluster-mesh/packaging.mk check-train-lock-integrity ENV=test-cd-tested-artifacts`, and real preproduction rollout/readiness; no manual bootstrap used as steady-state evidence. Workflow join is implemented (`release-receipts` job, deploy-preprod needs it, ci-gate requires it); first live evidence arrives on the post-merge main run.
- [ ] **Lot 3 — UAT and measured acceptance** (pending post-merge, same main-only cause as Lot 2)
  - [ ] Verify web and served IdP against the deployed immutable tuple; distinguish qualified PR, published images, preproduction readiness, and every selected package receipt. Exercise failed-promotion and rollback fixtures.
  - [ ] Budget to measure: image promotion ≤40s after candidate upload; full selected fresh npm train ≤195s; preproduction ≤75s versus 116s. Measure all from actual prerequisites and include queue time in complete event endpoints; already-published skips do not qualify the fresh-version budget.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the previous qualified preproduction image tuple and prior promotion/deploy recipes; issue a corrective npm version for released package defects, never overwrite published bytes or bypass artifact verification.
- [x] **Lot 4 — Docs consolidation**
  - [x] Updated this plan and the branch plan with measured receipts and remaining gaps; no EVOL notes or temporary spec scaffolding were created in this branch.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: application typecheck/lint is unchanged; `make test-ci-release-receipts test-publishable-manifests test-qualify-published-install ENV=test-cd-tested-artifacts` covers changed release scripts and negative receipt/registry/provenance cases.
  - [ ] Build: verify the final API/UI and package producer receipts, tested/scanned digests, and qualified tarball hashes; publishers and deployment must consume those bytes without rebuilding or repacking.
  - [ ] API regression: require complete `make test-api API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-cd-tested-artifacts` results on the selected candidate tuple before promotion, plus production-runtime/limits/restore receipts.
  - [ ] UI regression: require `make test-ui API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=test-cd-tested-artifacts` and both selected UI/IdP consumer results; UI-only delivery must retain the unchanged API digest.
  - [ ] E2E regression: require `make clean test-e2e API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=e2e-cd-tested-artifacts` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9410 UI_PORT=5610 MAILDEV_UI_PORT=1510 ENV=e2e-cd-tested-artifacts` on the recorded images, screen-driven IdP smoke, and real preproduction readiness/rollback; keep daily live qualification separate.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived. (Per OPTIM train rule, version bumps belong to the train integration lane; this branch avoids `packages/*/src/**` changes.)
  - [ ] Run `make scope-check ENV=test-cd-tested-artifacts` before each commit; end isolated service lots with `make down ENV=test-cd-tested-artifacts` and `make down ENV=e2e-cd-tested-artifacts`.
  - [ ] Create/update the PR using `BRANCH.md` text as PR body; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
