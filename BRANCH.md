# Feature: BR-78 — Build and transfer fewer image bytes

## Objective
- [ ] Build each selected image once and transport source-correct artifacts with verified exact digests.
- [ ] Measure complete readiness at ≤180s warm / 210s cold; API-case UI ≤120s / 150s.

## Scope / Guardrails
- [x] Base: origin/main; predecessor BR-77 merge aa559f58c; owner packet supersedes the historical BR-77 allocation in the train index.
- [x] Worktree: tmp/worktrees/ci-br78; branch: perf/ci-image-artifacts; merge main only, never rebase or force-push.
- [x] Make entry points; ENV last; no Python; commits under 150 changed lines; no attribution trailers.
- [x] Slot 0 author: ENV=test-ci-br78; API_PORT=9390, UI_PORT=5590, MAILDEV_UI_PORT=1490; check ports before services.
- [x] Local Docker only when necessary, under /home/antoinefa/.cache-tmp/sentropic-docker.lock; make down after each step.
- [x] Preserve every gate, runtime assertion, selected matrix and publication dependency; no timeout increases.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `plan/64-BRANCH_perf-ci-image-artifacts.md`
  - [x] `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - [x] `api/Dockerfile`
  - [x] `ui/Dockerfile`
  - [x] `e2e/Dockerfile`
  - [x] `scripts/test-api-tooling.sh`
  - [x] `scripts/check-ci-version-filters.sh`
  - [x] `scripts/ci/image-receipt.mjs`
  - [x] `scripts/ci/image-receipt.test.mjs`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `api/drizzle/*.sql`
  - [x] `plan/NN-BRANCH_*.md` except plan/64-BRANCH_perf-ci-image-artifacts.md
  - [x] `PLAN.md`
  - [x] `.track/**`
  - [x] Production deployment configuration.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/ci.yml` — BR78-EX1.
  - [x] `Makefile` — BR78-EX2.
  - [x] `.dockerignore` — BR78-EX3, exclude new transport artifacts from build inputs.
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs` — BR78-EX4, preserve filter isolation with exact image-guard exceptions.
  - [x] `e2e/tests/07_comment_assistant.spec.ts` — BR78-EX5, deterministic workspace initialization for the unchanged blocking journey.
  - [x] `spec/CHAT_MIGRATION_P0*.md` — BR78-EX6, unchanged upstream documents in the main integration merge only.
  - [x] `scripts/ci/ci-expected-results.test.mjs` — BR78-EX7, authenticated gate capture regression.
  - [x] `api/tests/unit/gateway-package-version.test.ts`, `package-lock.json`, `packages/cluster-mesh/**`, `packages/llm-gateway/package.json`, `packages/llm-mesh/**` — BR78-EX8, unchanged upstream content in the main integration merge only.
- [x] Exception process: record rationale, impact and rollback before edits; additional paths require bounded exceptions.

## Feedback Loop
- [x] BR78-EX8: integrate main 5e986a0b6 via merge to resolve GitHub's sole BRANCH.md conflict, retaining the BR78 plan. Incoming live-STT L13 package/test/lock/receipt files remain byte-identical to main; no STT changes are authored here. Impact: upstream integration only; rollback: reverse this merge with a new commit, never rewrite history. Requalify PR and cold dispatch on the resulting exact head.
- [x] PR #811 Opus r1 APPROVE at d072d24ec: close the action pin, record exact-head measurements, and explicitly carry remaining Lot 3/5 acceptance to a follow-up; owner retains merge authority.
- [x] BR78-EX1 names crazy-max/ghaction-github-runtime, exporting GitHub runtime/cache credentials to image producers. All four uses pin 3cb05d89e1f492524af3d41a1c98c83bc3025124 with a v3 comment; upstream refs/tags/v3 resolves directly to that commit via both GitHub API and git ls-remote (2026-10-28). Impact: immutable action source; rollback: revert these four pins with the transport/cache rollback.
- [x] Run 40713883861 attempt 1 at d072d24ecc4caf30dba18e4476366efd58a4d2bb is completed/success (1465s wall-clock). API/tools/UI/browser/scan/restore take 111/121/255/73/209/196s; IdP 290s, VSCode 142s, E2E a/b/c/d/e 270/154/303/200/211s, capacity 17s, gate 18s. Study section 11 records job IDs. Full UI warm 255s exceeds 180s by 75s; final-head cold and API-case UI targets must be measured, never inferred.
## AI Flaky tests
- [x] All deterministic failures block; no additional provider exception or timeout extension authorized.

## Orchestration Mode (AI-selected)
- [x] Multi-branch train; this author implements BR78 only; shared workflow changes serialized.

## UAT Management (in orchestration context)
- [ ] Qualify exact pushed SHA; preserve production runtime, IdP screens, restore and embedded UI assets.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Read rules, template, plan, study and BR77 post-merge procedure.
  - [x] Mechanical harness branch check and BR76 baseline capture: first BR77 main 40576115790 attempt 1, 1903s wall-clock; API/tools/UI/E2E jobs 109/262/533/30s (E2E reused registry).
  - [x] Inventory Docker/source/lock/toolchain/profile/embedded inputs and current gate membership; gate body and needs remain unchanged.
- [ ] **Lot 1 — Persistent build cache**
  - [x] Scope BuildKit cache import/export by runtime/tools/UI/E2E and architecture; preserve source-dependent keys and build arguments; remove forced UI cache bypass.
  - [x] Update scripts/test-api-tooling.sh for persistent/cold cache recipes and verified toolbox transport; check-ci-version-filters.sh also enforces E2E hash and receipt-guard coverage.
  - [x] Gate: make test-ci-api-tooling check-ci-version-filters ENV=test-ci-br78 passes; 16 receipt tests, 201 manifest tests, canonical input fixtures and tag-collision guards pass locally. Runtime filesystem checks await actual CI candidates; local all-case command had no built image and failed retained-path assertions.
- [ ] **Lot 2 — Digest-addressed transport**
  - [x] Implement scripts/ci/image-receipt.mjs and image-receipt.test.mjs; negative tests cover stale/wrong/missing receipts, modified archives and loaded image substitution.
  - [x] Verify source/workflow/inputs/cache identity, archive digest and loaded image ID at every load; E2E/VSCode use exact UI/E2E artifacts instead of registry tags.
  - [ ] Gate: make test-ci-image-receipts test-ci-api-runtime test-ci-api-tag-guard test-ci-api-tool-runtime ENV=test-ci-br78.
- [ ] **Lot 3 — Carried to follow-up: UAT and measured acceptance**
  - [ ] Real warm/cold runs for four producers, scanners and restore; workflow dispatch exposes explicit cold rebuilds; include embedded prerequisites/export/compression/upload/download/load.
  - [ ] Verify production smoke/limits, npm-absent runtime, tag collisions, IdP screens and both UI profiles with embedded Chrome/VSCode/desktop assets.
  - [ ] Rollback drill with scoped invalidation and fresh verified artifacts.
- [ ] **Lot 4 — Docs consolidation**
  - [x] Record baseline, cache-population/cold measurements, byte counts, exact producer/restore tuple, rejected native experiment and remaining gaps in plan/64 and study section 11; timing/IdP acceptance remains open.
- [ ] **Lot 5 — Carried to follow-up: remaining final validation**
  - [x] Head 9d7c58cab full PR run 40643738039 attempt 1 succeeds, including ci-gate 122674614619, all selected browser/VSCode/API/static/security/restore lanes; 1313s workflow wall-clock. Later E2E scan coverage must qualify on its own head; timing/review acceptance stays open.
  - [ ] Exact-head changed-file tests, typecheck-api lint-api typecheck-ui lint-ui and image/runtime guards through CI.
  - [ ] Exact-head API/UI/E2E/VSCode, container scans, smoke and restore; selected membership unchanged.
  - [ ] make scope-check before every make commit; selective staging; cleanup isolated environments.
  - [ ] Draft PR to main using this file as body; independent reviews, CI and measured head handoff; owner retains merge authority.

## Deferred to follow-up (owner: CI train owner; number to be assigned)
- [x] Lot 3 carry-over is explicit, not completed acceptance: complete the repeated warm/cold campaign including embedded prerequisites and all transfers, measure API-case UI, meet full readiness ≤180/210s and API-case UI ≤120/150s, and perform the scoped cache-invalidation/verified-artifact rollback drill. Keep all production, IdP, restore, profile and embedded-output assertions; verify through real run/attempt/job receipts.
- [x] Lot 5 carry-over is explicit, not completed acceptance: repeat the exhaustive listed local/static/build/runtime/regression commands and expected/executed membership comparison for the follow-up's final SHA, complete measured acceptance and independent review, then hand off closure to the merge operator. This PR still requires completed/success CI on its exact final head; performance targets and the rollback drill stay open.
- [x] Merged BR78 scope: persistent source-keyed image caches, digest-verified same-run artifact transport, source-level browser remediation, compiler/desktop cache isolation and bounded blocking regression fixes. No timing-budget or BR77 acceptance closure is claimed; the open Lot 2 aggregate local gate is not relabelled as passed.
