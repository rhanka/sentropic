# Fix: artifact builder worker memory request matches the measured build peak

## Objective
Stop kubelet evictions of artifact builder pods under node memory pressure (preprod 09/11 22:14, k8s facts: pod artifact-d40ef328… evicted at 116 Mi available, container at ~1.23 GiB against a 420Mi request; the supervisor died with it, `supervisor_relay_502`): set the worker memory request to the measured build peak (1280Mi) and cap concurrent builder pods at 2 so the requests fit the tenant `requests.memory` 3Gi quota.

## Scope / Guardrails
- api only: `api/src/services/artifacts/live/pods.ts`, `service.ts`, `product-builder.ts` and `api/tests/unit/artifacts-live/pods.test.ts`.
- Make-only workflow, no direct Docker commands.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/pods.ts`
  - `api/src/services/artifacts/live/service.ts`
  - `api/src/services/artifacts/live/product-builder.ts`
  - `api/tests/unit/artifacts-live/pods.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none

## Feedback Loop
- [ ] none

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**

## UAT Management (in orchestration context)
- [ ] Preprod: next artifact build runs without eviction; pod requests 1280Mi.

## Plan / Todo (lot-based)
- [x] Lot 1 — Worker memory request 1280Mi (measured peak), MAX_BUILDER_PODS and PRODUCT_HEAVY.maxPods 2 (2 x 1280Mi <= requests.memory 3Gi); quota tests.
- [ ] Lot 2 — CI green, review, merge, deploy-preprod.
