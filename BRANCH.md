# Feature: Preprod repin to the github-app form-origin build

## Objective
- [x] Bring the preprod tier to the main build that carries the GitHub App enrollment fixes of #960 (`referrer-policy: same-origin` so the enrollment forms keep their Origin and pass `csrf()`, manifest without `default_events`, install-state re-mint on the owner prompt): repin the api digest to the 7106defa7 build; repin the ui digest to the build published by the same main run.

## Scope / Guardrails
- [x] Branch deploy/preprod-repin-csrf from main 7106defa7 (merge of #960 fix/github-app-form-origin, exact 7106defa789e6c3a21f7dca886dea043d1856160), rebased onto main 8f2a262bb (exact 8f2a262bb52a490f8f9ac5c1f11505b04d94fc0f, builder repository registration, config only); worktree tmp/worktrees/preprod-repin-csrf; ENV=test-repin-csrf.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git.
- [x] Digest provenance: main CI run 42485651003 (head 7106defa7) publish-api-image SUCCESS + publish-ui-image SUCCESS (receipts `Published tested api: ghcr.io/rhanka/sentropic-api@sha256:16cbd3dc8eca86961e0b23ced70dad9bd4e20e74b970fcc9ae635b3104b4723c (config sha256:d451cd4f4cf8815cd57c550aecb96a948fca87ea35fbdbf9fdbc68fa8c011a55)` and `Published tested ui: ghcr.io/rhanka/sentropic-ui@sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0 (config sha256:b03dae0e57aba9fc8031165198a938b93aac30825e6723483d0f43b6eea0a525)`), verified in GHCR by anonymous manifest fetch (manifest sha256 and config digest identical).
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
- [x] `attention`: this pin merges ONLY onto a main that carries #960: the api digest pinned here is the first build carrying it. An overlay apply restarts nothing by itself: the operator's apply step (CD re-applies ../preprod-a4 with these pins) rolls the api out.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one deploy PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin to the form-origin build**
  - [x] `deploy/k8s/overlays/preprod/kustomization.yaml`: api digest swapped sha256:ea366543…f6 → sha256:16cbd3dc8eca86961e0b23ced70dad9bd4e20e74b970fcc9ae635b3104b4723c; ui digest swapped sha256:ec201329…54 → sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0; provenance comment rewritten (run 42485651003).
  - [x] `deploy/ci/preprod-a4/bundle.selftest.mjs`: api and ui tag expectations swapped to the new digests; the four prod asserts unchanged.
- [x] **Lot 2 — Final validation**
  - [x] `make check-preprod-images ENV=test-repin-csrf` PASS (rendered pins verified by anonymous digest pull, 2026-11-08).
  - [x] `docker-slot.sh make test-artifact-content-manifests API_PORT=8847 UI_PORT=5247 MAILDEV_UI_PORT=1147 ENV=test-repin-csrf` PASS (artifact-content bundle selftest, A4 unit 32/32, A4 bundle selftest: api/auth-idp/artifact-content on the new api digest, ui on sha256:bf1aa509…e0, prod unchanged).
  - [ ] PR « deploy(preprod): repin to the github-app form-origin fix », CI green on the exact head, GLM review `.h2a/reviews/pr-<n>-glm.md`, merge by s-conductor.
