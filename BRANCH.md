# Feature: Preprod artifact-content provisioning (content serving + api builder host)

## Objective
- [x] Open `APP_ARTIFACT_CONTENT_ENABLED` for preprod in the repo IaC (content serving, live edge composed), and open the api's `APP_ARTIFACT_HOST_ENABLED` required by the builder composition, with every non-secret wiring only: overlay patches, required Secret-name references, object-store egress NetworkPolicy, selftest per-tier expectations.

## Scope / Guardrails
- [x] Branch deploy/preprod-artifact-content from main 4b4c8632d; worktree tmp/worktrees/preprod-artifact-content; ENV=test-artifact-prep.
- [x] PREPROD ONLY: prod overlays and base stay untouched; no Secret value in Git (names only).
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-deployment.yaml`
  - `deploy/k8s/overlays/preprod/patch-api-artifact-host.yaml`
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `deploy/k8s/overlays/preprod/artifact-content-object-store-networkpolicy.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
  - `deploy/ci/artifact-content/network.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `api/**`
  - `apps/**`
  - `packages/**`
  - `deploy/k8s/base/**`
  - `deploy/k8s/overlays/prod/**`
  - `deploy/k8s/overlays/preprod-a4/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention`: DRAFT-held PR — merge only after the owner-provisioned Secrets exist (`artifact-content-signing`, new keys of `artifact-content-runtime` and `sentropic-api`), the DB role `artifact_content` is granted, and the object store passes a signed GetPublicAccessBlock qualification (Scaleway fr-par answers 405 NotImplemented — see the prep doc `.tmp/rv/artifact-content-preprod-prep.md`).
- [ ] `attention`: PR #952 (deploy/preprod-gb4-live) touches `patch-artifact-content-config.yaml` and the same selftests; s-conductor sequences the merge (#952 first) and rebases this branch.
- [ ] `attention`: rolling restart after apply: CD restarts nothing on ConfigMap changes; the required-Secret flips make a premature apply freeze the rollout instead of crash-looping the supervisor relay.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one overlay PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Plan this branch** (this file; first commit)
- [x] **Lot 1 — Preprod overlay wiring**
  - [x] cm artifact-content `APP_ARTIFACT_CONTENT_ENABLED: "1"` (inspection value).
  - [x] Deployment artifact-content patch: explicit env `APP_ARTIFACT_CONTENT_ENABLED=1`, envFrom secretRef `artifact-content-runtime` required (`optional: false`), signing volume `artifact-content-signing` required (`optional: false`, defaultMode 0440 kept).
  - [x] Deployment api patch: explicit env `APP_ARTIFACT_HOST_ENABLED=1` (api CONTENT/READER stay 0).
  - [x] cm api `APP_ARTIFACT_QUOTA_BYTES: "1073741824"` (instance.ts module-load check with host enabled).
  - [x] New additive NetworkPolicy `allow-artifact-content-to-object-store` (Egress, same-namespace object store labels, TCP 9000; no ipBlock).
  - [x] kustomization wiring (resources + patches).
- [x] **Lot 2 — Selftests per tier**
  - [x] bundle-checks: per-tier flag expectations (preprod content=1 on artifact-content only, api host=1; digest gate covers both), per-tier envFrom/volumes requiredness, quota expectations, object-store rule expectations.
  - [x] bundle.selftest: new deny cases (wrong-deployment content flag, content host flag in preprod, prod opens nothing, dropped/widened object-store rule, requiredness regressions).
  - [x] network.selftest: per-tier object-egress property (preprod reaches only the same-namespace store on 9000; both tiers keep external 443 denied).
  - [x] Lot gate: `docker-slot.sh make test-artifact-content-manifests API_PORT=8846 UI_PORT=5246 MAILDEV_UI_PORT=1146 ENV=test-artifact-prep` (render/test containers only; no compose stack started).
- [x] **Lot 3 — Draft PR**
  - [x] Push branch; `gh pr create --draft` with the BRANCH.md-derived body starting with « DRAFT — merge only after the Secrets listed below exist »; CI may run; no merge request.
