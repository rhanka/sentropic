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
- [x] Exception process: record rationale, impact and rollback before edits; additional paths require bounded exceptions.

## Feedback Loop
- [x] BR78-EX1 authorized by owner packet: producers and image consumers need persistent caches and verified transport. Impact: artifact production/loading; gate dependencies and blocking power retained. Rollback: revert workflow transport/cache hunks and invalidate br78 cache scopes.
- [x] BR78-EX2 authorized by owner packet: Make image cache/build/save/load recipes, API_TOOL_VERSION and receipt tests. Lightweight Node receipt CLI in CI avoids downloading a compiler/browser image just to hash bytes. Impact: named image entry points only. Rollback: revert recipes and requalify previous artifacts; never bypass identity or runtime checks.
- [x] BR77 timing remains open: capacity.md requires first actual-main attempt and strict PR/main ≤2288s proof; green correctness alone does not qualify timing. BR78 does not close BR77 acceptance.
- [ ] Record every real run ID/attempt/SHA, job duration, queue/cache state, failure, retry and budget breach.

## AI Flaky tests
- [x] All deterministic failures block; no additional provider exception or timeout extension authorized.

## Orchestration Mode (AI-selected)
- [x] Multi-branch train; this author implements BR78 only; shared workflow changes serialized.

## UAT Management (in orchestration context)
- [ ] Qualify exact pushed SHA; preserve production runtime, IdP screens, restore and embedded UI assets.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [x] Read rules, template, plan, study and BR77 post-merge procedure.
  - [ ] Mechanical harness branch check and baseline capture through BR76 metrics.
  - [ ] Inventory Docker/source/lock/toolchain/profile/embedded inputs and current gate membership.
- [ ] **Lot 1 — Persistent build cache**
  - [x] Scope BuildKit cache import/export by runtime/tools/UI/E2E and architecture; preserve source-dependent keys and build arguments; remove forced UI cache bypass.
  - [x] Update scripts/test-api-tooling.sh for persistent/cold cache recipes and verified toolbox transport; retain filter coverage checks.
  - [ ] Gate: make test-ci-api-tooling check-ci-version-filters ENV=test-ci-br78.
- [ ] **Lot 2 — Digest-addressed transport**
  - [x] Implement scripts/ci/image-receipt.mjs and image-receipt.test.mjs; negative tests cover stale/wrong/missing receipts, modified archives and loaded image substitution.
  - [x] Verify source/workflow/inputs/cache identity, archive digest and loaded image ID at every load; E2E/VSCode use exact UI/E2E artifacts instead of registry tags.
  - [ ] Gate: make test-ci-image-receipts test-ci-api-runtime test-ci-api-tag-guard test-ci-api-tool-runtime ENV=test-ci-br78.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Real warm/cold runs for four producers, scanners and restore; workflow dispatch exposes explicit cold rebuilds; include embedded prerequisites/export/compression/upload/download/load.
  - [ ] Verify production smoke/limits, npm-absent runtime, tag collisions, IdP screens and both UI profiles with embedded Chrome/VSCode/desktop assets.
  - [ ] Rollback drill with scoped invalidation and fresh verified artifacts.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Record measured receipts and remaining gaps in plan/64 and study; missing durations remain to measure.
- [ ] **Lot 5 — Final validation**
  - [ ] Exact-head changed-file tests, typecheck-api lint-api typecheck-ui lint-ui and image/runtime guards through CI.
  - [ ] Exact-head API/UI/E2E/VSCode, container scans, smoke and restore; selected membership unchanged.
  - [ ] make scope-check before every make commit; selective staging; cleanup isolated environments.
  - [ ] Draft PR to main using this file as body; independent reviews, CI and measured head handoff; owner retains merge authority.
