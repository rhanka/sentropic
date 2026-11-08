# Feature: Preprod repin to the S2S service issuer build

## Objective
- [x] Bring the preprod tier to the main build that carries the S2S service issuer fix of #963 (github-app broker and artifact builder guards verify standalone IdP S2S tokens against `OAUTH_SERVICE_ISSUER_URL` / `OAUTH_SERVICE_RESOURCE_URI` instead of the plain-HTTP request origin): repin the api digest to the 1a2e7f7f9 build; the ui digest stays on the build published by the 7106defa7 run (publish-ui-image skips on this head).

## Scope / Guardrails
- [x] Branch deploy/preprod-repin-963 from main 1a2e7f7f9 (merge of #963 fix/preprod-s2s-service-issuer, exact 1a2e7f7f916e759414f72ff6aeb9e81ca781fae9); worktree tmp/worktrees/preprod-repin-963; ENV=test-repin-963.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git.
- [x] Digest provenance: main CI run 42495208447 (head 1a2e7f7f9) publish-api-image SUCCESS (receipt `Published tested api: ghcr.io/rhanka/sentropic-api@sha256:f9e11434aa5fe23c87f3446b2c133bad438fc22105998f167f1267ca4cc610c2 (config sha256:248846bb6bd2dd112356e81351f2d5aaa137c84d074d2d325e0312a2beb2c122)`), verified in GHCR by anonymous manifest fetch (HTTP 200, manifest sha256 and config digest identical). publish-ui-image SKIPS on this head (no ui path changed), so the ui digest stays the one published by the 7106defa7 build (run 42485651003, publish-ui-image SUCCESS): sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0 (GHCR anonymous fetch HTTP 200, config sha256:b03dae0e57aba9fc8031165198a938b93aac30825e6723483d0f43b6eea0a525).
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
- [x] `attention`: this pin merges ONLY onto a main that carries #963: the api digest pinned here is the first build carrying it, and the `OAUTH_SERVICE_ISSUER_URL` / `OAUTH_SERVICE_RESOURCE_URI` ConfigMap keys of #963 are read at api start only. An overlay apply restarts nothing by itself: the operator's apply step (CD re-applies ../preprod-a4 with these pins) rolls the api out.
- [x] `attention`: `make test-preprod-a4-manifests ENV=test-repin-963` cannot run locally (its `A4_TEST_IMAGE` ghcr.io/rhanka/sentropic-api-tools:tool-d4d252a5… is not published); the same A4 bundle selftest runs inside `make test-artifact-content-manifests` (as on #962).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one deploy PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin to the S2S service issuer build**
  - [x] `deploy/k8s/overlays/preprod/kustomization.yaml`: api digest swapped sha256:16cbd3dc…3c → sha256:f9e11434aa5fe23c87f3446b2c133bad438fc22105998f167f1267ca4cc610c2; ui digest unchanged sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0; provenance comment rewritten (run 42495208447, publish-ui-image skips).
  - [x] `deploy/ci/preprod-a4/bundle.selftest.mjs`: api tag expectation swapped to the new digest; ui expectation and the four prod asserts unchanged.
- [x] **Lot 2 — Final validation**
  - [x] `make check-preprod-images ENV=test-repin-963` PASS (both rendered pins verified by anonymous digest pull, 2026-11-08).
  - [x] `docker-slot.sh make test-artifact-content-manifests API_PORT=8851 UI_PORT=5251 MAILDEV_UI_PORT=1151 ENV=test-repin-963` PASS (artifact-content bundle selftest 211 PASS 0 failures, A4 unit 32/32, A4 bundle selftest: api/auth-idp/artifact-content on sha256:f9e11434…c2, ui on sha256:bf1aa509…e0, prod unchanged).
  - [ ] PR « deploy(preprod): repin to the S2S service issuer fix », CI green on the exact head, merge by s-conductor.
