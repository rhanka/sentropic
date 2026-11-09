# Feature: Builder host build API answers in the GitBuildJobState vocabulary

## Objective
- [x] `POST /v1/builds` and `GET /v1/builds/:artifactId/:jobId` return the host-facing job state of the G0 v3 §2.6 contract (`GitBuildJobState` of `@sentropic/artifacts`: `build_pending`, `published`, `build_failed`) instead of the builder ledger states (`accepted`, `published`, `failed`).
- [x] Preprod 2026-11-09 01:34Z (artifact bbe43e9c, commit 93116b8): the builder answered 202 `{state: "accepted"}` in 9 ms; the immo host client (`packages/artifacts-host/src/git-mode/build-api.ts` `parseStatus`) accepts only `GitBuildJobState`, threw `provider_unavailable`, so `git_publish` never moved the binding to `build_pending` and the host answered the builder's job callback with 409 `job_not_pending`; the build failed as `builder_unavailable` before any pod.

## Scope / Guardrails
- [x] Branch fix/builder-job-state-contract from origin/main; worktree tmp/worktrees/fix-builder-job-state; ENV=test-fix-job-state; ports API 8899, UI 5299, Maildev 1199.
- [x] The builder ledger states stay internal (`BuildJobRecord.state` unchanged); only the HTTP view maps them.
- [x] Make only; no Python; no attribution trailers; no CI skip or rerun; never ENV=dev.
- [x] No package source change, so no package version bump.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/host-build-api.ts`
  - `api/tests/unit/artifacts-live/host-build-api.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
  - `ui/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] No scope exception required.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). No AI test in scope.
- [ ] test-e2e (5) failed on 4ad97c63c: tests/00-ai-generation.spec.ts:181 (AI use-case generation from the home page, 1.1m, provider-dependent); the diff touches only the builder host build API view. Not accepted as flaky until a fresh run on the next head passes; no rerun, no skip, no timeout change.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one owner-urgent fix PR, one CI.
- Rationale: two files, one contract mapping.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Contract mapping**
  - [x] `host-build-api.ts`: `view()` maps `accepted` → `build_pending`, `published` → `published`, `failed` → `build_failed`.
  - [x] `host-build-api.test.ts`: the HTTP answers assert the host states; the ledger assertions keep the internal states.
- [ ] **Lot 2 — Validation**
  - [ ] `make test-api-unit SCOPE=tests/unit/artifacts-live/host-build-api.test.ts ENV=test-fix-job-state` via docker-slot.sh.
  - [ ] `make typecheck-api ENV=test-fix-job-state`.
