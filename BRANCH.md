# Feature: A-LIVE forge lease reader (SG0-app lease, GB4-P forge reads)

## Objective
- [ ] Replace `UNCONFIGURED_FORGE_READS` with real forge reads through the in-process SG0-app lease: host binding mapping (immutable per generation), head/reachable/snapshot over GitHub REST, filtered and bounded staging, and `source()` re-verification (s-archi forge-lease-reader contract 08/11).

## Scope / Guardrails
- [x] Branch feat/alive-forge-lease-reader from origin/main 4b4c8632d; worktree tmp/worktrees/alive-forge-lease-reader; ENV=test-forge-lease.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] No deploy change here: `ARTIFACT_BUILDER_REPOSITORIES_JSON` and the installation ref go through the preprod IaC overlay of the ops lane.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/env.ts`
  - `api/src/services/artifacts/**`
  - `api/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/**`
  - `packages/**`
  - `api/src/services/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/app.ts` (BR-FLR-EX1)
  - `api/src/routes/github-app.ts` (BR-FLR-EX1)
  - `api/src/services/cluster-mesh/github-app-host.ts` (BR-FLR-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention` BR-FLR-EX1: the contract (§3, §5) calls the same SG0-app lifecycle service as `POST /github-app/broker/lease` in process. Reason: the service is built inside `createGitHubAppHostRouter`; it is extracted as `createGitHubAppHostService` (same custody store, key, GitHub API and invalidation bus) and the product lease is composed in `routes/github-app.ts`, then passed by `app.ts` to the builder. Impact: no route or behaviour change for the SG0-app mount. Rollback: revert the three files.
- [x] `attention`: no node/npm version helper exists for the cache identity; `BUILDER_TOOLCHAIN` records the measured node v26.13.0 of `BUILDER_IMAGE`, and the npm version is `0.0.0-unverified` (source-gap) until measured in the pinned image.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one wagon, one PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tests first (contract §6, seven groups)**
  - [x] mapping, host bodies, head/reachable, snapshot filters and limits, `source()` re-verification, GET-only and token hygiene, fail-closed configuration.
- [x] **Lot 2 — Binding mapping and configuration**
  - [x] `forge-binding.ts`: `ARTIFACT_BUILDER_REPOSITORIES_JSON`, validation order, binding immutable per generation (409 `binding_conflict`).
  - [x] Host build and live APIs parse and validate `binding` before scheduling anything.
- [x] **Lot 3 — Lease reader**
  - [x] `forge-lease.ts`: lease cache until expiry − 60 s, GitHub REST reads, tarball through one codeload redirect, filters, limits, manifest per `stagingRef`, `source()` re-download and digest re-check.
  - [x] `createProductBuilder` composes `remoteHostForge(createLeaseForgeReads(...))`; `app.ts` passes the product lease.
  - [x] Lot gate: `make typecheck-api`, `make lint-api`, scoped `make test-api-unit SCOPE=tests/unit/artifacts-live ENV=test-forge-lease`.
- [ ] **Lot 4 — PR**
  - [ ] PR « feat(alive): read the forge through the SG0-app lease », CI green on the exact head, GLM review, merge by s-conductor.
