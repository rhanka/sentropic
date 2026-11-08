# Feature: keep the API up when the builder config is invalid; own dependency-cache storage

## Objective
- [x] With `ARTIFACT_BUILDER_ENABLED=1` and any missing/invalid builder value, the API boots, logs `artifact_builder_refused` naming the variable (never its value), keeps the builder mount at 503 `builder_unavailable`, starts no scheduler (s-archi review F2, PR #951, corrected by s-archi).
- [x] The dependency cache reads its own `ARTIFACT_BUILDER_CACHE_S3_*` storage settings and no longer requires `APP_ARTIFACT_HOST_ENABLED=1`; a missing cache setting follows the F2 refusal behaviour (F1 option (a)).

## Scope / Guardrails
- [x] Branch fix/alive-builder-f1f2 from origin/main 4b4c8632d; worktree tmp/alive-builder-f1f2; ENV=test-alive-f1f2, ports API 9891 / UI 5283 / Maildev 1093.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] The sentropic artifacts MCP host is NOT enabled by the builder: `APP_ARTIFACT_HOST_ENABLED` stays untouched in configuration and code outside the live tree.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/**`
  - `api/src/app.ts`
  - `api/src/config/env.ts`
  - `api/tests/**`
  - `api/src/services/artifacts/live/README.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/src/services/artifacts/instance.ts` (left: its now-unused `productPrivateCacheBlobs` export stays; flagged for a follow-up)
  - `deploy/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: `instance.ts` keeps the `productPrivateCacheBlobs` export after this branch (outside the allowed paths here); it no longer has any importer on this branch. Follow-up deletion belongs to a lane allowed in `api/src/services/artifacts/instance.ts`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`; never additive timeouts; explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one follow-up, one PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — F2 graceful boot refusal**
- [x] `product-builder.ts`: any missing/invalid value under the flag logs `artifact_builder_refused` (code `builder_unavailable`, reason = the variable name, never its value) and returns null instead of throwing.
  - [x] app.ts unchanged wiring: null builder keeps the 503 `builder_unavailable` mount and starts no scheduler; the rest of the API keeps serving.
  - [x] Tests: flag on + one missing value -> null builder + one log naming the variable; value never in the payload; app-level boot test (imports `app`) -> API root 200, builder route 503 `builder_unavailable` (S2S guard stubbed, bound host), log line present, `createLiveScheduler` never called.
- [x] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api-unit SCOPE=tests/unit/artifacts-live ENV=test-alive-f1f2`.
- [x] **Lot 2 — F1 own dependency-cache storage**
  - [x] `cache-storage.ts`: `ARTIFACT_BUILDER_CACHE_S3_BUCKET`, `ARTIFACT_BUILDER_CACHE_S3_REGION`, `ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID`, `ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY` (optional `ARTIFACT_BUILDER_CACHE_S3_ENDPOINT`), first missing name in fixed order; `builderCacheBlobs(settings)` lazily opens the same private-object storage contract as the artifact host.
- [x] `product-builder.ts`: replace the `APP_ARTIFACT_HOST_ENABLED=1` requirement with the cache-settings validation; wiring `deps.cacheBlobs(settings)`; refuse naming the missing cache variable (F2 behaviour).
  - [x] `app.ts`: pass `builderCacheBlobs`; drop the `productPrivateCacheBlobs` import.
  - [x] Tests: composes without `APP_ARTIFACT_HOST_ENABLED`; settings carried to `cacheBlobs` from the `ARTIFACT_BUILDER_CACHE_S3_*` values; each missing cache name refuses gracefully.
  - [x] README: F2 refusal behaviour + the new cache env names, `APP_ARTIFACT_HOST_ENABLED` requirement removed.
- [x] Lot gate: `make typecheck-api`, `make lint-api`, `make test-api-unit SCOPE=tests/unit/artifacts-live ENV=test-alive-f1f2`.
- [ ] **Lot 3 — PR**
  - [ ] PR « fix(alive): keep the API up when the builder config is invalid; own cache storage », CI green on the exact head, GLM review, merge by s-conductor.
