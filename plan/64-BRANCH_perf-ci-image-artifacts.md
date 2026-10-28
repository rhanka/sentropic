# Feature: BR-78 — Build and transfer fewer image bytes

## Objective
- [ ] Cache stable tool layers and transport source-correct production artifacts by exact digest.
- [ ] Branch `perf/ci-image-artifacts`, step 3 of nine; train order BR-78 → BR-79; dependencies: BR-77 merged; BR-76 timing and BR-77 prepared closures.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [ ] Work only in `tmp/worktrees/ci-image-artifacts`; rebase on main after predecessor merge; one implementation branch active on the shared workflow/Makefile.
- [ ] Make entry points only; `ENV` last; tests on `ENV=test-ci-image-artifacts` or `ENV=e2e-ci-image-artifacts`, never `dev`; no secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9390, UI_PORT=5590, MAILDEV_UI_PORT=1490; verify availability before starting services and pass all three ports to service commands.
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
  - [ ] `.github/workflows/ci.yml` under BR78-EX1; `Makefile` under BR78-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [ ] BR78-EX1 — Planned workflow exception: change `build-api-image`, `build-api-tool-image`, `build-ui`, `build-e2e`, and their image consumers in `security-container` and `test-smoke-restore`. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR78-EX2 — Planned Makefile exception: change image cache/build/save/load targets and `API_TOOL_VERSION`; add `test-ci-image-receipts`; remove UI forced `--no-cache` without weakening hash inputs. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.
- [x] Owner execution packet (2026-10-28): tmp/worktrees/ci-br78, ENV=test-ci-br78, merge-only updates; draft PR #811. BRANCH.md declares workflow/Makefile exceptions plus bounded .dockerignore transport and manifest-filter fixture exceptions with rollback.
- [x] Actual BR77 first-main baseline 40576115790 attempt 1, source aa559f58c57d0453239668505ccfeaebe5599a1e: success, 1903s wall-clock, 233.9 runner-minutes; image jobs API 109s, tools 262s, full UI 533s, E2E 30s (registry reuse). Detailed job IDs and scope in study section 11; strict PR/main acceptance remains open.
- [x] Initial PR 40635754181 attempt 1 superseded/cancelled; API 260s and E2E 201s are partial cancelled executions. Cold dispatch 40636446215 attempt 1 on a4d98dcde: E2E job 122644590256 succeeds in 151s including upload; manifest fixture job 122644590282 fails, corrected by exact image-guard filter exceptions. Branch author owns remaining qualification.
- [x] Head 13712a5d2 receipts: normal/cache-population run 40640414275 attempt 1 has API/tools/UI/E2E 230/258/398/248s; forced no-import/no-export cold run 40640411046 has 234/200/380/149s. Timing acceptance stays open; full warm and API-case UI are to measure. Study section 11 records job IDs, source/workflow identities, sizes and exact producer/restore digests.
- [x] Producer/consumer correctness at 13712a5d2: runtime/tool interfaces, UI builds/tests, restore 122659204773 (158s) and scans 122660115540 (134s) pass; IdP screen smoke 122660292811 fails HTTPS-upgraded assets and blocks ci-gate. Requalify the browser/origin correction before any acceptance.
- [x] Native-store experiment at 43ce8700d rejected/rolled back after exact-digest consumers fail; guards unchanged. Source now pins the actual API/E2E Node base digests and retains every failed/cancelled attempt; no budget is ticked complete.
- [x] Full PR qualification at 9d7c58cab: run 40643738039 attempt 1 succeeds in 1313s including ci-gate 122674614619. IdP 122671543007 validates all original screen/token assertions in 220s on the qualified browser at the SUT loopback origin; full UI 400s, API 287s, tools 209s, E2E 109s. This does not close timing acceptance. Later E2E scan addition preserves browser coverage and requires a fresh head qualification.
- [x] Continuation baseline 7b62ad02a: PR 40646332385 refuses 102 browser findings; API/tools/UI/E2E/scan/restore take 80/87/421/97/183/168s. Cold 40646328430 takes 246/233/505/164/329/175s and also fails the browser gate. Study section 11 retains job IDs and every superseded continuation.
- [x] Source remediation rejects Trixie (40652025952, 57 OS findings); pinned Alpine native Chromium/headless-shell + FFmpeg pass DOM/screenshot/video build probes (122704840141). Browser transport falls from 774,218,936 to 517,331,610 bytes. Its remaining two CVE-2026-14456 findings have an upstream package fix: explicitly pin available libcrypto3/libssl3 3.5.9-r0. Fresh patched-head security qualification remains required; no exception or severity change.
- [x] UI test transport preserves all 83 files / 489 tests and forces fresh execution, reducing the step from 87s to 37s. Identified cold UI 122707557109 in 40656087209 takes 329s versus 505s, including 28s desktop + 113s production + 36s tests + 106s static; 210s remains unmet. Cache-enabled candidate 122704841128 takes 418s; production/static cache exports are 37.5/59.4s and cached dependency materialization 51.8s.
- [x] Warm-cache blocker measured in published assets: identical tracked UI/desktop inputs and main base produce different cowork.exe digests across 40652025952/40655027953, while metadata is identical. COPY ui misses and both profiles recompile. Study section 11 records exact hashes and the image-boundary correction below, plus the BR79 scheduling boundary; no 180s warm acceptance is claimed.
- [x] Fix the compiler boundary without changing the Windows binary: validate fresh static assets separately, exclude desktop bytes from UI source COPY and copy them into both final profile outputs after compilation. The existing API-only/local optional-desktop path and full-UI prerequisite remain; fresh complete timing/security/journey receipts must qualify this change.

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
  - [ ] Pre-UAT static gate: `make typecheck-api lint-api typecheck-ui lint-ui API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=test-ci-image-artifacts`; both impacted image/tooling consumers must pass before Lot 3.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Verify actual production-image smoke/limits, served IdP screens, and restore still consume the qualified image; UI profile output includes its expected embedded files.
  - [ ] Budget to measure: longest complete image-readiness branch ≤180s warm / 210s cold including embedded prerequisites and transfer; API-case UI branch ≤120/150s. Do not substitute the PR's 495s UI job for the main API-case 138s observation.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore previous build/transport recipes and invalidate only this branch's cache scopes; rebuild and verify fresh artifact receipts, preserving digest and production-runtime checks.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make typecheck-api lint-api typecheck-ui lint-ui API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=test-ci-image-artifacts`; retain image-input/filter fixtures from Lots 1–2.
  - [ ] Build: `make build-api build-ui-image API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=e2e-ci-image-artifacts` plus the existing API-tool and E2E image producers; verify warm/cold input invalidation and record the exact produced digests.
  - [ ] API regression: `make test-api API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=test-ci-image-artifacts` and `make test-ci-api-runtime test-ci-api-tool-runtime ENV=test-ci-image-artifacts`; production-runtime and restore lanes must consume the recorded candidate images.
  - [ ] UI regression: `make test-ui API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=test-ci-image-artifacts`; verify both Vite profiles and embedded extension/desktop assets against their build-input receipts.
  - [ ] E2E regression: `make clean test-e2e API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=e2e-ci-image-artifacts` and `make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts API_PORT=9390 UI_PORT=5590 MAILDEV_UI_PORT=1490 ENV=e2e-ci-image-artifacts`; preserve every selected browser group, screen-driven IdP smoke, and restore assertion on the same production-image tuple.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-image-artifacts` before each commit; end isolated service lots with `make down ENV=test-ci-image-artifacts` and `make down ENV=e2e-ci-image-artifacts`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.
