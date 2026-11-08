# Feature: Preprod builder repository registration

## Objective
- [x] Register the immo builder repository on the preprod tier: set `ARTIFACT_BUILDER_REPOSITORIES_JSON` in the preprod api ConfigMap patch with the SG0-app enrollment ref of the immo installation, so the forge-lease reader (#955) stops refusing `forge_unconfigured`.

## Scope / Guardrails
- [x] Branch deploy/preprod-builder-repository from origin/main 0aa3b4043 (merge of #959 deploy/preprod-final-live); worktree tmp/worktrees/preprod-builder-repository; ENV=test-builder-repo.
- [x] PREPROD ONLY: prod overlays and base untouched; no Secret value in Git (the enrollment ref is an opaque registry handle, not a credential).
- [x] Value shape per forge-binding.ts `forgeConfig`: exactly five keys, `installationRef` = SG0-app enrollment ref `enroll_<36 hex/dash>` (read from `.tmp/rv/enrollment-ref.txt`, checked non-numeric), entry equal to the GITHUB_APP_TARGETS_JSON target, `allowedSubPaths: [""]`.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
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
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: a ConfigMap change restarts nothing; the api reads `ARTIFACT_BUILDER_REPOSITORIES_JSON` at its next rollout. After merge, s-conductor runs `rollout restart deploy/api` if the CD apply alone does not roll the api out.
- [x] `acknowledge`: closes the `blocked` item of #959 (enrollment ref missing at its deadline); no image repin here, the pins of #959 stay.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one fix PR, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no flaky test encountered this branch.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Register the builder repository**
  - [x] `deploy/k8s/overlays/preprod/patch-api-config.yaml`: `ARTIFACT_BUILDER_REPOSITORIES_JSON` = `[{"storageScopeId":"radar-immobilier-preprod","repoId":"radar-immobilier","locator":"rhanka/radar-immobilier","installationRef":"enroll_d6fac2e1-8328-4e74-8bc4-08aeafe54f11","allowedSubPaths":[""]}]`.
  - [x] `deploy/ci/artifact-content/bundle-checks.mjs`: the same exact value in `preprodBuilder` (deepEqual gate over every `ARTIFACT_*`/`GITHUB_APP_*` key; prod keeps none).
  - [x] `deploy/ci/artifact-content/bundle.selftest.mjs`: runtime-parser coherence (five keys, `enroll_` ref, equal to the GitHub App target, root-only subPath) and deny cases (numeric installation id, other storage scope, extra subPath, value dropped on preprod).
- [ ] **Lot 2 — Final validation**
  - [x] `docker-slot.sh make test-artifact-content-manifests ENV=test-builder-repo` PASS (211 PASS, 0 failures: the seven new builder repository deny cases and the runtime-parser coherence check included; A4 unit 32/32; A4 bundle selftest on the #959 pins unchanged).
  - [x] `make scope-check` PASS (C2).
  - [ ] PR « deploy(preprod): register the builder repository radar-immobilier », CI green on the exact head, Opus read-only review `.h2a/reviews/pr-<n>-opus.md`, merge by s-conductor.
