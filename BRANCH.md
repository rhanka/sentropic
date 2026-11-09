# Feature: Preprod repin to the forge tarball and live teardown build

## Objective
- [x] Bring the preprod tier to the main build ec3c0bcc8 that carries #975 (the forge tarball reader skips link entries of GitHub archives and names every unstable_tree refusal) and #971 (live teardown on a gone/terminal pod, Background deletion, lease-fenced Service replacement, named builder_unavailable reasons): repin the api digest; the ui digest stays on the build published by the 7106defa7 run (publish-ui-image skips on this head).

## Scope / Guardrails
- [x] Branch deploy/preprod-repin-975 from main ec3c0bcc8 (merge of #975 fix/forge-tar-unstable); worktree tmp/worktrees/preprod-repin-975; ENV=test-repin-975.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git.
- [x] Digest provenance: main CI run 42627071304 (head ec3c0bcc8) publish-api-image SUCCESS (receipt `Published tested api: ghcr.io/rhanka/sentropic-api@sha256:8a0039e8198e98b1433003266ae389c6f0cf2360b05d1ac77c97f01144675c61`), verified in GHCR by anonymous manifest fetch (HTTP 200). The ui digest stays sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0 (7106defa7 build, run 42485651003).
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
- [x] `attention`: this pin merges ONLY onto a main that carries #975 and #971: the api digest pinned here is the first build carrying it. An overlay apply restarts nothing by itself: the operator's apply step (CD re-applies ../preprod-a4 with these pins) rolls the api out.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one deploy PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin to the forge tarball and live teardown build (#975, #971)**
  - [x] `deploy/k8s/overlays/preprod/kustomization.yaml`: api digest swapped sha256:69bd39eb…44 → sha256:8a0039e8198e98b1433003266ae389c6f0cf2360b05d1ac77c97f01144675c61 (main ec3c0bcc8, run 42627071304); ui digest unchanged sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0; provenance comment rewritten.
  - [x] `deploy/ci/preprod-a4/bundle.selftest.mjs`: api tag expectation swapped to the new digest; ui expectation and the prod asserts unchanged.
- [ ] **Lot 2 — Validation**
  - [x] GHCR anonymous manifest fetch of the api digest: HTTP 200 (2026-11-09).
  - [ ] No local make run on this branch: the preprod-a4 and artifact-content selftests run in the PR CI on the exact head.
  - [ ] PR « deploy(preprod): repin the api to the ec3c0bcc8 build (forge tar links, live teardown) », CI green on the exact head, merge by s-conductor.
