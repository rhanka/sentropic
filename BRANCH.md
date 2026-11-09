# Feature: Preprod repin to the host build API job state contract build

## Objective
- [x] Bring the preprod tier to the main build that carries #969 (the builder host build API answers POST /v1/builds and GET /v1/builds in the GitBuildJobState vocabulary build_pending|published|build_failed instead of the ledger states accepted|failed, so a host git_publish no longer fails with provider_unavailable before moving its binding to build_pending): repin the api digest to the b1a570474 build; the ui digest stays on the build published by the 7106defa7 run (publish-ui-image skips on this head).

## Scope / Guardrails
- [x] Branch deploy/preprod-repin-969 from main b1a570474 (merge of #969 fix/builder-job-state-contract); worktree tmp/worktrees/preprod-repin-969; ENV=test-repin-969.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git.
- [x] Digest provenance: main CI run 42549233598 (head b1a570474) publish-api-image SUCCESS (receipt `Published tested api: ghcr.io/rhanka/sentropic-api@sha256:69bd39eb0aee104b59e39271c9badc06ebf0410f54032b5a6d476c6832604444`), verified in GHCR by anonymous manifest fetch (HTTP 200). publish-ui-image SKIPS on this head (no ui path changed), so the ui digest stays sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0 (7106defa7 build, run 42485651003).
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `apps/**`
  - `packages/**`
  - `ui/**`
  - `deploy/k8s/base/**`
  - `deploy/k8s/overlays/prod/**`
  - `deploy/k8s/overlays/preprod-a4/**`
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: this pin merges ONLY onto a main that carries #969: the api digest pinned here is the first build carrying it. An overlay apply restarts nothing by itself: the operator's apply step (CD re-applies ../preprod-a4 with these pins) rolls the api out.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one deploy PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin to the host build API job state contract build**
  - [x] `deploy/k8s/overlays/preprod/kustomization.yaml`: api digest swapped sha256:f9e11434…c2 → sha256:69bd39eb0aee104b59e39271c9badc06ebf0410f54032b5a6d476c6832604444; ui digest unchanged sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0; provenance comment rewritten (run 42512631809, publish-ui-image skips).
  - [x] `deploy/ci/preprod-a4/bundle.selftest.mjs`: api tag expectation swapped to the new digest; ui expectation and the four prod asserts unchanged.
- [x] **Lot 2 — Final validation**
  - [x] `make check-preprod-images ENV=test-repin-969` PASS (both rendered pins verified by anonymous digest pull, 2026-11-08).
  - [x] `docker-slot.sh make test-artifact-content-manifests API_PORT=8857 UI_PORT=5257 MAILDEV_UI_PORT=1157 ENV=test-repin-969` PASS (artifact-content bundle selftest 211 PASS 0 failures, A4 unit 32/32, A4 bundle selftest: api/auth-idp/artifact-content on sha256:69bd39eb…44, ui on sha256:bf1aa509…e0, prod unchanged).
  - [ ] PR « deploy(preprod): repin to the remote live rows persistence fix », CI green on the exact head, merge by s-conductor.
