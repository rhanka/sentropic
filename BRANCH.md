# Feature: A-LIVE builder composition and f1 fence signer (GB4-P BLOCKER 1 + 2)

## Objective
- [x] Compose `createBuilderService` in the API behind `ARTIFACT_BUILDER_ENABLED` (default off: unchanged 503 mount), start the live scheduler, and sign/push the f1 controller fence to artifact-content (s-archi builder-composition contract 08/11).

## Scope / Guardrails
- [x] Branch feat/alive-builder-composition from origin/main 591f5eee1; worktree tmp/worktrees/alive-builder-composition; ENV=test-builder-comp.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] No deploy change here: the flag, ConfigMaps and Secrets go through the preprod IaC overlay of the ops lane.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/app.ts`
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
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: no SG0-app lease forge reader exists on main (and no spec maps a live key to its repository and branch); `UNCONFIGURED_FORGE_READS` refuses every read as `builder_unavailable`/`forge_unconfigured`, so builds and revives fail closed per operation while the host API answers. A follow-up wagon must compose the lease reader.
- [x] `attention`: `createArtifactLiveService` takes the Kubernetes client as an input (`kubernetes`), so the product passes `createInClusterKubernetes(placement)` and tests a fake.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one wagon, one PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — f1 controller fence signer**
  - [x] `live-fence.ts`: `ARTIFACT_LIVE_CONTROLLER_KEY` (`<kid>=<base64url>`), `ARTIFACT_LIVE_EDGE_INTERNAL_URL` (internal Service Host only), `routes.revoke/ready` sign `signLiveFence` and POST `/_live-fence/v1`; non-204 resent freshly signed, then `builder_unavailable`.
- [x] **Lot 2 — Builder composition behind the flag**
  - [x] `forge.ts`: remote-host forge port, `fastForward` refused (`fast_forward_remote_host`).
  - [x] `product-builder.ts`: `createProductBuilder(env, deps)` null unless `ARTIFACT_BUILDER_ENABLED=1`; boot refusal names the missing variable; binding view of the last host reconcile; heavy queue 1641 MiB / 4 pods; scheduler every 30 s, once per process.
  - [x] `app.ts` mounts `createProductArtifactBuilderRouter(productBuilder)` and stops the scheduler on exit.
  - [x] Lot gate: `make typecheck-api`, `make lint-api`, scoped `make test-api-unit SCOPE=tests/unit/artifacts-live ENV=test-builder-comp`.
- [ ] **Lot 3 — PR**
  - [ ] PR « feat(alive): compose the builder service and the f1 fence signer behind a flag », CI green on the exact head, GLM review, merge by s-conductor.
