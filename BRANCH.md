# Feature: Separate CI Tool Image and Hardened Production Image SUT

## Objective
- [ ] Remove the npm CLI from the production API image runtime stage (remediating CVE-2026-93748 / GHSA-ch52-4w7c-c8xp) by separating a CI tool image from the prod image, caching the tool image across runs, running the API test matrix inside the tool image, and qualifying the production image as SUT.

## Scope / Guardrails
- [x] Work only in `tmp/ci-prod-image-sut`, branch `feat/ci-prod-image-sut`, base `7d1002505`; mechanical harness branch check passed.
- [x] Scope: Option O-min+ of decision dossier 632-npm-image-dossier.md v4.2 under owner authorization (2026-10-03).
- [x] Production image drops `npm` and `npx` from its runtime stage; runtime entrypoints stay `node dist/index.js` and `node apps/auth-idp/dist/index.js`; migrations run at boot.
- [x] CI tool image carries npm, test runner, workspace dependencies, and test sources; content-hashed tag on inputs and cached.
- [x] The 15-job API test matrix runs in the tool image on source with unchanged semantics.
- [x] Production image tested as SUT by external runner (smokes IdP, restore, smoke, limit) over HTTP; E2E and VSCode keep running against prod.
- [x] Out of scope: endpoint conversion to HTTP (option O), k8s manifests, scanner policy/thresholds, vulnerability register exceptions.
- [x] Make-only, Docker-first workflow; no native npm on host, no Python; ENV always last: `API_PORT=9491 UI_PORT=5691 MAILDEV_UI_PORT=1591 ENV=test-ci-prod-image-sut`.
- [x] Atomic commits under 150 lines; selective git add; commit via `make commit MSG="..."`.
- [x] Owner authorizes branch push and PR to main on 2026-10-04 after review fixes and local gates; no merge or publication.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `api/Dockerfile`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `docker-compose.ci.yml`
  - `docker-compose.yml`
  - `api/tests/smoke/**`
  - `apps/auth-idp/screen-smoke.ts`
  - `BRANCH.md`
  - `.gitignore`
  - `docs/ci-images.md`
  - `scripts/test-api-tooling.sh`
  - `scripts/ci/test-api-tooling.sh` (removal only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - `deploy/k8s/**`
  - `packages/**`
  - `.security/vulnerability-register.yaml`
  - `.cursor/rules/**`
  - `rules/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `docker-compose*.yml` (only when strictly needed for the tool runner or production SUT)
- [x] **Exception process**:
  - Declare exception ID `BRCI-EXn` in `## Feedback Loop` with reason, impact, and rollback strategy.

## Feedback Loop
- [x] BRCI-EX1 acknowledge: owner authorizes `api/Dockerfile` edits. Rationale: introduce `ci-tools` target stage carrying npm, devDependencies, and test runners, and drop npm/npx from `production` runtime stage to remediate CVE-2026-93748. Impact: production container has no npm CLI; tool image carries npm and test dependencies. Rollback: revert Dockerfile changes. Acceptance: prod image fails `command -v npm`, prod container boots and migrates DB at startup.
- [x] BRCI-EX2 acknowledge: owner authorizes `Makefile` edits. Rationale: define `API_TOOL_IMAGE_NAME`, `API_TOOL_VERSION` content hash, tool image lifecycle targets (`build-api-tool-image`, `check-api-tool-image`, `pull-api-tool-image`, `save-api-tool`, `load-api-tool`, `publish-api-tool-image`), and wire test matrix/smoke targets. Impact: Make orchestrates tool image builds and CI test runs. Rollback: revert Makefile targets. Acceptance: tool image builds, saves, and executes tests.
- [x] BRCI-EX3 acknowledge: owner authorizes `.github/workflows/ci.yml` edits. Rationale: build/pull/cache the tool image once per content hash, run the 15-job matrix inside the tool image, and execute smokes against the production image SUT. Impact: CI pipeline uses cached tool image and tests prod image. Rollback: revert workflow edits. Acceptance: CI pipeline runs successfully with tool image caching.
- [x] BRCI-EX4 conditional: build brief permits `docker-compose*.yml` edits only if strictly needed. Rationale: define tool image service or test execution override for running tests against prod SUT. Impact: compose service configurations for testing. Rollback: revert compose edits. Acceptance: compose stacks up/down cleanly without orphaned containers; no tracked compose change in Lot 1.
- [x] BRCI-EX4 activation: `docker-compose.ci.yml` separates the immutable tool runner from API/IdP production services, with no source mounts. Impact: CI-only service definitions; rollback: remove the overlay and revert its Make routing.
- [x] BRCI-EX4 identity: permit the API image reference in `docker-compose.yml` to consume the recorded build artifact identity. Impact: tests can pin the loaded image; unset reference retains the regular tag. Rollback: revert the image-reference substitution.
- [x] BRCI-EX5 acknowledge: permit `apps/auth-idp/screen-smoke.ts` to select the toolbox's system Chromium executable. Rationale: Playwright browser bundles do not support Alpine. Impact: optional runner configuration only; rollback: remove the executable override.

## AI Flaky tests
- [x] Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [x] Rationale: Direct sequential lots in worktree `tmp/ci-prod-image-sut`, verified by local reviewer at each lot boundary.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only.
- [x] Execution flow: develop and test in `tmp/ci-prod-image-sut`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Read `.h2a/inputs/build_brief.md` and `.h2a/inputs/632-npm-image-dossier.md` (v4.2).
  - [x] Confirm isolated worktree `tmp/ci-prod-image-sut` on branch `feat/ci-prod-image-sut`.
  - [x] Define environment mapping: `API_PORT=9491 UI_PORT=5691 MAILDEV_UI_PORT=1591 ENV=test-ci-prod-image-sut`.
  - [x] Initialize `.env` with branch ports and environment variables.
  - [x] Define scope boundaries and declare `BRCI-EX1` through `BRCI-EX4`.

- [x] **Lot 1 — Tool image target & prod runtime without npm**
  - [x] Add `ci-tools` target stage in `api/Dockerfile`.
  - [x] Drop npm/npx and `/usr/local/lib/node_modules/npm` from `production` stage in `api/Dockerfile`.
  - [x] Define `API_TOOL_IMAGE_NAME` and `API_TOOL_VERSION` content hash in `Makefile`.
  - [x] Add `build-api-tool-image`, `check-api-tool-image`, `pull-api-tool-image`, `save-api-tool`, `load-api-tool`, `publish-api-tool-image` targets in `Makefile`.
  - [x] Local proof: build production image and verify `docker run <prod> sh -c 'command -v npm'` fails.
  - [x] Local proof: verify production container boots and database migrations run successfully at startup.
  - [x] API and compiled IdP boot without source mounts; both health endpoints return HTTP 200.
  - [x] Fresh database has 42 public and 9 control migrations; restart leaves migration counts unchanged.
  - [x] Local proof: build tool image and verify `docker run <tool> sh -c 'command -v npm && npx vitest --version'` succeeds.
  - [x] Tool runner check: `api/tests/unit/client-ip.test.ts` passes in the image without mounts or dependency installation (18 tests).
  - [x] Cache check: unchanged build reuses the local image; input addition, modification and rename change the tag; deletion restores it.
  - [x] Artifact check: `make save-api-tool load-api-tool` succeeds.
  - [x] Write `.h2a/build/lot1_report.md` for reviewer.

- [x] **Lot 2 — Matrix on tool image & smokes/limit as external runner against prod SUT**
  - [x] Add CI-only tool runner and production API/IdP services without workspace mounts.
  - [x] Add cached Chromium/Playwright tooling and compiled-IdP smoke routing; preserve the existing screen assertions.
  - [x] Register an intercepted HTTPS callback in the disposable IdP fixture, so the production CSP and consent assertions remain intact.
  - [x] Give each browser smoke a fresh disposable user so prior consent cannot bypass its consent-screen assertion.
  - [x] Restore before production boot; verify data preservation, settings/control schema and migration-journal stability on restart.
  - [x] Source unit suite passes (113 files, 1011 passed, 2 skipped); queue, security, artifact-store, object-registry and outbox suites pass in the tool runner.
  - [x] Update `docker-compose*.yml` and Makefile test targets for tool image usage.
  - [x] Wire 15-job matrix: source suites run in the cached tool image; smoke and limit run once against production SUT.
  - [x] Wire smoke IdP, smoke restore, smoke, and limit to run against the production container as external HTTP runner.
  - [x] All four endpoint shards pass (120 files, 973 tests); production smoke (13), limit (4) and restore (9) pass; compiled IdP screen smoke passes. Provider AI subsets and full hosted E2E remain unrun locally.
  - [x] Run available credential-free test suites and verify no suite is duplicated in CI routing.
  - [x] Write `.h2a/build/lot2_report.md` for reviewer.

- [x] **Lot 3 — CI cache wiring, verification & docs**
  - [x] Extend production tag inputs to compiled IdP and migration sources; ignore only the generated identity receipt directory and include the CI overlay in change filters.
  - [x] Normalize the production rate-limit switch to an empty value when the test runner requests enforcement; existing HTTP assertions remain unchanged.
  - [x] Scan the non-shipping toolbox with the existing HIGH/CRITICAL compliance gate; no policy or register changes.
  - [x] Preserve the UI-only container scan when the toolbox build is intentionally skipped; toolbox failures still block API/global runs.
  - [x] Wire `.github/workflows/ci.yml` with exact content-tag archive caching; a cache hit loads the toolbox without any build.
  - [x] Record and verify the production artifact image ID during save/load; use it for runtime and scans.
  - [x] E2E, VSCode and publication load the current run artifact; reject canonical tag collisions and promote the verified image without re-pulling.
  - [x] Serialize API publication and fail closed on registry inspection errors other than a missing manifest; remote publication remains unexecuted.
  - [x] Validate local cache reuse and image archive save/load on unchanged inputs; hosted second-run cache validation remains pending without a push.
  - [x] Pin the production artifact config ID through local load, runtime and scan; transport a receipt and reject mismatches. Registry OCI and deployed digest evidence remain follow-ups.
  - [x] Document architecture in `docs/ci-images.md` and finalize reports.
  - [x] Write `.h2a/build/lot3_report.md` for reviewer.
  - [x] Record the blocking toolbox scan: 52 HIGH and 4 CRITICAL unaccepted findings; production has zero. No severity/register changes; full qualification remains open.
  - [x] Apply Lot 1 review registry, cache-log and tools-hash findings with failing-then-passing checks in `scripts/test-api-tooling.sh`, wired into CI.
  - [x] Purge `/root/.npm` from production alongside npm/npx; add a runtime regression gate for CLI, global package tree and cache absence.
  - [x] Trigger CI for toolbox `tools/**` and regression-script changes so hash invalidation and its tests are exercised.
  - [x] Recheck all four regressions, ShellCheck/actionlint, scope/hash coverage, source unit (1011 passed, 2 skipped), production scan (zero findings), restore (9), smoke (13), limit (4) and compiled IdP browser smoke after review fixes.
  - [x] Correct CI manifest wiring: keep toolbox regressions outside the reserved `scripts/ci` publisher namespace and name the main-image helper with the `-image` suffix.

- [ ] **Lot N-2** UAT
  - [ ] Web app smoke verification on running stack.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Review documentation updates and document pending qualification explicitly.

- [x] **Lot N — Local validation and handoff**
  - [x] Run `make scope-check`; PASS C2.
  - [x] Run `make check-ci-version-filters`; PASS. Containerized actionlint also passes.
  - [x] Run security scans: production PASS; toolbox compliance FAIL, recorded for conductor.
  - [x] Final lot reports written; Lot 1 external review PASS with four findings addressed. Push/PR are authorized; CI qualification pending, no merge or publication.
