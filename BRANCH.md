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
- [ ] Baseline receipts: main merge run `41939652646` attempt 1 (head `4d7517d94`, pre-BR-81): wall 1049s; `publish-api-image` 93s, `publish-ui-image` 76s, `deploy-preprod` 71s, `publish-artifacts` 47s, `ci-gate` 19s. Post-BR-81 merge run `41981165023` pending at capture time.
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
- [ ] **Lot 1 — Provider-boundary protocol fixtures**
  - [x] Offline protocol gate: 15/15 HTTP/SSE, tools, errors/retries, cancellation/reconnection, egress, vision, document and PPTX request-shape tests pass; application qualification remains pending.
  - [ ] Add the named HTTP/SSE fixture and tests; cover streaming, tool requests/results, malformed output, errors/rate limits, cancellation, reconnection, model routing, and retries; assert outbound request shape and forbid unexpected real egress.
  - [ ] Adapt only the two named runtime composition seams and ten named API AI test files; preserve application HTTP/auth/database/queue/tool behavior. Runtime fixture configuration is test-only and cannot become a production bypass.
  - [ ] Lot gate: new `make test-ci-provider-fixtures ENV=test-ci-br81`; run every changed API AI file through `make test-api-ai` scoped by file on the assigned isolated environment; failures must block.
- [ ] **Lot 2 — Balanced browsers and daily live execution**
  - [ ] Add `browser-shards.mjs` and its test; build explicit file/project manifests using real durations, initially about six balanced shards; every selected test executes exactly once, one setup per shard, retaining real login coverage.
  - [ ] Update the listed browser setup/config/specs and inventory check; replace fixed autosave/provider sleeps with responses, persisted state, or events; preserve the production artifact under test.
  - [ ] Add the daily workflow, `live-provider-receipt.mjs`, and its test; retain the full selected API AI and browser/VSCode provider assertions with exact application/package tuple, schedule health, result, calls, and cost.
  - [ ] Lot gate: new `make test-ci-browser-shards test-ci-live-provider-receipt ENV=test-ci-br81`; `make check-e2e-inventory ENV=test-ci-br81`; all selected browser/VSCode shards and API groups on the assigned ports; one actual scheduled live run plus failure/schedule-health fixtures.
  - [ ] Pre-UAT static gate: `make typecheck-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` and `make lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` must pass before Lot 3 because both named API runtime seams change.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Exercise web streaming/tools/persistence/cancellation and VSCode streaming on tested production images; prove fixture traffic stays local while a separate daily receipt records real provider calls.
  - [ ] Budget to measure: every complete browser/API shard ≤180s, VSCode ≤150s; compare browser maximum 255s from the source sample. PR/merge unexpected live calls = 0; missing daily data stays to measure, and live failures remain visible.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore prior test dispatch/transport wiring with visible provider status; keep application assertions and required deterministic checks; do not silently treat failed live or deterministic journeys as success.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; UI source typecheck/lint is not applicable because no UI source is edited; retain fixture/shard/live-receipt checks from Lots 1–2.
  - [ ] Build: `make build-api build-ui-image API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` with the selected provider-fixture overlay; record production-image digests and prove fixture configuration cannot enable a production endpoint bypass.
  - [ ] API regression: `make test-api API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; run every selected group and all ten named AI files against local HTTP/SSE fixtures, with no live credentials or allowed deterministic failure.
  - [ ] UI regression: `make test-ui API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; preserve the complete existing UI unit/DOM suite despite unchanged UI source.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-ci-br81`; execute every generated file/project shard exactly once, reconcile expected/executed membership, retain real login, and verify the tested production-image tuple.
  - [ ] Daily live regression: retain one actual scheduled run plus failure/schedule-health fixtures for the exact application/package tuple; provider assertions, calls, cost, and failures remain visible separately from blocking deterministic PR/merge results.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-br81` before each commit; end isolated service lots with `make down ENV=test-ci-br81` and `make down ENV=test-ci-br81`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
