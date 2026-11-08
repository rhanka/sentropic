# Feature: Preprod repin to the forge-lease-reader build

## Objective
- [x] Bring the preprod tier to the latest published main build: repin the api digest to the 4c5f7be5c build (forge-lease-reader #955) on top of the GB4 configuration of #952. The builder repositories value (`ARTIFACT_BUILDER_REPOSITORIES_JSON`) is NOT set in this PR: the SG0-app enrollment ref was not available at the lane deadline.

## Scope / Guardrails
- [x] Branch deploy/preprod-final-live from main 28acf6393 (merge of #952 deploy/preprod-gb4-live, exact 28acf639397b2d94fde32efe45d94f3cd8df86d4); worktree tmp/worktrees/preprod-final-live; ENV=test-final-iac.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git.
- [x] Digest provenance: main CI run 42467148857 (head 4c5f7be5c) publish-api-image SUCCESS + release-receipts SUCCESS (receipt `Published tested api: ghcr.io/rhanka/sentropic-api@sha256:ea36654306736125b08cb6902722a9ea765f887d22d48095b93be73ec1139ef6 (config sha256:58ed9427e61f22a51ff541b649787527bb6765d1ce6417237d074aa89eb69c4a)`), verified in GHCR by anonymous manifest fetch (config digest identical). publish-ui-image SKIPS on this head (no ui path changed since the last publishing build), so the ui digest stays the one published by the 7990bc182 build (run 42463322455, publish-ui-image SUCCESS): sha256:ec201329c2d6fed7fb725c412b46994fe7f36d8bf1bf560d53e1d7200d04ee54.
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
- [x] `blocked`: `ARTIFACT_BUILDER_REPOSITORIES_JSON` is deliberately NOT set: the SG0-app enrollment ref (i-cond lane, `.tmp/rv/enrollment-ref.txt`) was still missing at the 40-min wait deadline (the i-cond session waits for a human response in its own session — s-conductor, `.tmp/rv/delivery-0500.md` 04:55). Fail-closed: until the value lands (follow-up PR), every forge read and every binding refuses `forge_unconfigured` (forge-binding.ts `forgeConfig`), the builder otherwise composes normally (GB4 #952). No substitution was attempted: the ref must be the enrollment ref `enroll_<36 hex/dash>`, never a numeric GitHub installation id.
- [x] `attention`: this pin merges ONLY onto a main that carries #952 (GB4) and #955 (forge lease reader): the api digest pinned here is the first build carrying both. A ConfigMap/overlay apply restarts nothing: the operator's apply step (CD re-applies ../preprod-a4 with these pins) rolls the api out.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one deploy PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin to the latest published build**
  - [x] `deploy/k8s/overlays/preprod/kustomization.yaml`: api digest swapped to sha256:ea36654306736125b08cb6902722a9ea765f887d22d48095b93be73ec1139ef6 (run 42467148857 publish receipts, GHCR manifest verified, config digest identical); ui digest unchanged sha256:ec201329c2d6fed7fb725c412b46994fe7f36d8bf1bf560d53e1d7200d04ee54; provenance comment rewritten (publish-ui-image skips on 4c5f7be5c).
  - [x] `deploy/ci/preprod-a4/bundle.selftest.mjs`: api tag expectation swapped to the new digest; ui expectation and the four prod asserts unchanged.
- [x] **Lot 2 — Final validation**
  - [x] `make check-preprod-images ENV=test-final-iac` PASS (both rendered pins verified by anonymous digest pull, 2026-11-08).
  - [x] `docker-slot.sh make test-artifact-content-manifests API_PORT=8843 UI_PORT=5243 MAILDEV_UI_PORT=1143 ENV=test-final-iac` PASS (artifact-content bundle selftest, A4 unit 32/32, A4 bundle selftest: api/auth-idp/artifact-content on sha256:ea366543…f6, ui on sha256:ec201329…54, prod unchanged).
  - [x] `make scope-check` PASS (C2).
  - [ ] PR « deploy(preprod): repin to the forge-reader build and register the builder repository », CI green on the exact head, GLM review `.h2a/reviews/pr-<n>-glm.md`, merge by s-conductor.
