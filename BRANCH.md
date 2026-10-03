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
- [x] No push, PR, merge, or publish without conductor.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `api/Dockerfile`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `api/tests/smoke/**`
  - `BRANCH.md`
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

## AI Flaky tests
- [x] Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
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

- [ ] **Lot 2 — Matrix on tool image & smokes/limit as external runner against prod SUT**
  - [ ] Update `docker-compose*.yml` and Makefile test targets for tool image usage.
  - [ ] Wire 15-job matrix execution in tool image on source.
  - [ ] Wire smoke IdP, smoke restore, smoke, and limit to run against the production container as external HTTP runner.
  - [ ] Run test suites and verify no suite runs twice.
  - [ ] Write `.h2a/build/lot2_report.md` for reviewer.

- [ ] **Lot 3 — CI cache wiring, verification & docs**
  - [ ] Wire `.github/workflows/ci.yml` tool image build/pull/cache logic with content hash.
  - [ ] Validate cache reuse on unchanged inputs.
  - [ ] Pin image digest where cheap according to G-PROD v4.1.
  - [ ] Document architecture in docs and finalize reports.
  - [ ] Write `.h2a/build/lot3_report.md` for reviewer.

- [ ] **Lot N-2** UAT
  - [ ] Web app smoke verification on running stack.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Review documentation updates and remove temporary plan notes.

- [ ] **Lot N — Final validation**
  - [ ] Run `make scope-check`.
  - [ ] Run `make check-ci-version-filters`.
  - [ ] Run security scans: `make test-api-security-container`.
  - [ ] Final lot report and handoff.
