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
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/app.ts` (BR-FLR-EX1)
  - `api/src/routes/github-app.ts` (BR-FLR-EX1)
  - `api/src/services/cluster-mesh/github-app-host.ts` (BR-FLR-EX1)
  - `.github/workflows/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention` BR-FLR-EX1: the contract (§3, §5) calls the same SG0-app lifecycle service as `POST /github-app/broker/lease` in process. Reason: the service is built inside `createGitHubAppHostRouter`; it is extracted as `createGitHubAppHostService` (same custody store, key, GitHub API and invalidation bus) and the product lease is composed in `routes/github-app.ts`, then passed by `app.ts` to the builder. Impact: no route or behaviour change for the SG0-app mount. Rollback: revert the three files.
- [x] `attention`: no node/npm version helper exists for the cache identity; `BUILDER_TOOLCHAIN` records the measured node v26.13.0 of `BUILDER_IMAGE`, and the npm version is `0.0.0-unverified` (source-gap) until measured in the pinned image.
- [x] `attention`: GLM 5.3 review r1 APPROVE (0 blocker, 0 major). Fixed: README forge and binding doc, malformed-archive test. Deferred: total (192 MiB) and compressed (256 MiB) cap fixtures, subPath-aware pod layout (configure `allowedSubPaths: ['']` meanwhile).
- [x] `attention`: GLM 5.3 review r2 (delta 4f2ac3983) APPROVE.
- [x] `attention`: CI run 42456383782 on 4f2ac3983 failed only `test-e2e (4)`: `tests/02-organizations.spec.ts:391` (Read-only viewer, détail: champs non éditables), `page.waitForURL: Timeout 10000ms exceeded`. The delta from a4409fe84 (all 6 e2e shards green in run 42455395884) touches no runtime file (README, BRANCH.md, one unit test), so the failure is not caused by this branch; a fresh pull_request run is triggered by this commit (no rerun).
- [x] `attention`: s-archi R1 (REQUIRED) fixed: `POST /v1/builds` validates the binding and stores it with its job (immutable per job, 409 `binding_conflict`); the build-only run records it at the HostJob generation right after resolving the job, before any forge read; forge reads use the generation of the current non-DORMANT runtime, else `remote.session`. Not changed: build-only still reads the D0 binding view (`remote.session`) and the staged draft of that generation.
- [x] `attention`: GLM 5.3 delta review of R1 (50d85894c..1b0bb8cd9, before the rebase on e675ea02d) APPROVE: 0 blocker, 0 major. Fixed: README fallback wording (DORMANT or absent). Deferred: build-only D0 binding view without any reconcile (F1, D0 follow-up), product-builder composition test of `runtimeGeneration` (F2).
- [x] `attention`: CI run 42463660327 on a38efcbed failed only `test-e2e (3)`: `tests/00-access-control.spec.ts:284` (permissions commentaires: viewer/editor/admin), admin `Résoudre` button still disabled after 5000 ms. The same branch code passed all 6 e2e shards in run 42462935360 (fa950917b); the delta fa950917b..a38efcbed is #956 only (standalone `cm-account-approve` script, its build entry, Makefile, deploy, docs), no UI or API runtime change; a fresh pull_request run is triggered by this commit (no rerun).

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
