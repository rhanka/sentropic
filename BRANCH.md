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
- [x] Exception process: record rationale, impact and rollback before edits; additional paths require bounded exceptions.

## Feedback Loop
- [x] BR78-EX1 authorized by owner packet: producers and image consumers need persistent caches and verified transport. Impact: artifact production/loading; gate dependencies and blocking power retained. Rollback: revert workflow transport/cache hunks and invalidate br78 cache scopes.
- [x] BR78-EX1 includes IdP's browser consumer: reuse the exact E2E artifact instead of adding Chromium to every API toolbox; add build-e2e to IdP prerequisites, retain screen assertions. Rollback: restore browser toolbox recipe and IdP command together.
- [x] IdP browser runs through its official Make target with --rm on the isolated Compose network and a read-only script mount; the ordinary E2E service uses host networking, which cannot resolve auth-idp.
- [x] BR78-EX3: exclude new root transport archives/receipts from subsequent UI build contexts. VSCode assets are generated inside npm run build, so their existing ignore stays. Impact: prevent transport bytes from invalidating/copying into UI source layers. Rollback: remove these two ignore patterns with the compressed transport recipes.
- [x] BR78-EX1/EX2: remove duplicate external Chrome/VSCode builds; ui/package.json build already executes both. Preserve all prior output assertions inside ui/Dockerfile; desktop remains an explicit embedded prerequisite. Each distinct Vite profile still builds its own extension outputs.
- [x] BR78-EX4: cold run 40636446215 job 122644590282 rejects the new image-guard filters under its blanket scripts/ci isolation assertion. Permit only the two exact image receipt paths in global, retain all other scripts/ci and publisher isolation assertions. Impact: image guards trigger full qualification. Rollback: restore assertion and remove those two workflow filters together.
- [x] Cold API/tools jobs 122644591261/122644591096 pass runtime guards in 250/255s, breaching 210s. Logs identify Docker export/import at 79.1/83.9s. BR78-EX1/EX2 now use pinned Docker 29.9.2/Buildx 0.38.1, native driver and containerd image store (documented GHA-cache support); no intermediate --load tarball. Rollback: restore docker-container setup and --load together, preserving every guard.
- [x] Cold UI job 122644591027 fails its existing static endpoint contract (488/489 tests pass): preserve the workflow's VITE_API_BASE_URL environment and pass it to the new static image exporter, with the existing assertion unchanged.
- [x] Native-store rollback: head 43ce8700d producer jobs pass, but restore 122655378122 and API consumer 122655438883 reject loaded identity mismatches across stores. Restore docker-container/--load with unchanged digest guards; fresh-cache toolbox takes 340s including 114.1s cache export. The native experiment is rejected, not timing acceptance.
- [x] Flatten prepared API/toolbox filesystems onto the same Node base: keep pruned production dependencies, patched npm/esbuild tooling and every retained source/runtime assertion; omit hidden install-cache and deleted devDependency layers from transported images. Qualification remains open until fresh CI verifies bytes, runtime and timings.
- [x] Pin API/toolbox/IdP and E2E Node bases to the exact digests resolved in jobs 122658342949/122657596849; base-image changes now invalidate the source hash explicitly. Toolbox fixtures reject floating Node bases; existing UI/Go pins remain.
- [x] IdP correction qualified: head 9d7c58cab, run 40643738039 attempt 1, job 122671543007 passes in 220s. Full Chromium at the SUT loopback origin validates served login/consent, authorization code, id_token iss/aud/nonce/sub and userinfo; production headers and timeouts unchanged. Earlier jobs 122660292811/122661023083 retain their HTTPS-upgrade failures.
- [x] BR78-EX2 includes a CI-only public-origin override passed to Compose on stdin and browser network-namespace sharing with this project's auth-idp container. Select a loopback test origin; NODE_ENV=production, CSP/HSTS, startup health wait, login/consent/token checks and the qualified image remain unchanged. No repository Compose file changes. Fresh CI must qualify the correction. Rollback: restore the bridge origin and browser runner together.
- [x] BR78-EX1/EX2 preserve browser scan coverage after moving IdP Chromium out of the toolbox: security-container also waits for build-e2e, verifies its archive and scans it through the unchanged HIGH/CRITICAL parser/compliance gate. ci-gate dependencies and all previous scan checks remain; no vulnerability exception or severity is relaxed. Rollback: restore the scanned browser toolbox and its IdP runner together.
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
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Real warm/cold runs for four producers, scanners and restore; workflow dispatch exposes explicit cold rebuilds; include embedded prerequisites/export/compression/upload/download/load.
  - [ ] Verify production smoke/limits, npm-absent runtime, tag collisions, IdP screens and both UI profiles with embedded Chrome/VSCode/desktop assets.
  - [ ] Rollback drill with scoped invalidation and fresh verified artifacts.
- [ ] **Lot 4 — Docs consolidation**
  - [x] Record baseline, cache-population/cold measurements, byte counts, exact producer/restore tuple, rejected native experiment and remaining gaps in plan/64 and study section 11; timing/IdP acceptance remains open.
- [ ] **Lot 5 — Final validation**
  - [x] Head 9d7c58cab full PR run 40643738039 attempt 1 succeeds, including ci-gate 122674614619, all selected browser/VSCode/API/static/security/restore lanes; 1313s workflow wall-clock. Later E2E scan coverage must qualify on its own head; timing/review acceptance stays open.
  - [ ] Exact-head changed-file tests, typecheck-api lint-api typecheck-ui lint-ui and image/runtime guards through CI.
  - [ ] Exact-head API/UI/E2E/VSCode, container scans, smoke and restore; selected membership unchanged.
  - [ ] make scope-check before every make commit; selective staging; cleanup isolated environments.
  - [ ] Draft PR to main using this file as body; independent reviews, CI and measured head handoff; owner retains merge authority.
