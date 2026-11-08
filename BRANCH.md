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
  - `deploy/k8s/overlays/preprod/artifact-object-store/**`
  - `deploy/ci/artifact-content/object-store/**`
  - `deploy/ci/preprod-a4/topology.selftest.mjs` (BRAOS-EX1)
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
- [ ] `attention`: DRAFT-held PR — s-conductor merges after #954 (F1/F2) and forge-lease-reader. Provisioned 2026-11-08 (ops record `.tmp/rv/preprod-object-store.md`, names only): Secrets `artifact-content-signing`, `artifact-object-store`, content keys of `artifact-content-runtime`, builder cache keys of `sentropic-api`; DB role `artifact_content`; store qualified by a signed GetPublicAccessBlock (4 x true) BEFORE wiring. MinIO answers 501 NotImplemented, so the store is RustFS 1.0.4 (same in-namespace pattern).
- [ ] `attention`: s-conductor decision — with #954 the builder no longer reads `APP_ARTIFACT_HOST_ENABLED`; this branch still opens the api artifact host (`patch-api-artifact-host.yaml` + quota) without any `APP_ARTIFACT_S3_*` in `sentropic-api` (not minted, outside the owner list): drop both before merge, or authorize an api host read/write credential.
- [x] `BRAOS-EX1`: `deploy/ci/preprod-a4/topology.selftest.mjs` — rationale: the rendered A4 sequence fenced only Deployments/CronJobs, while the runbook fence (step 2) also scales every non-Postgres StatefulSet to zero; the new `artifact-object-store` StatefulSet made the simulation diverge (`writer_not_fenced`). Impact: test simulation only, `verification-boundary.mjs` stays strict. Rollback: revert the commit.
- [ ] `attention`: open architecture item — the reader activation consume needs INSERT on `artifact_host.activation_namespaces` and UPDATE privilege for its FOR SHARE / FOR UPDATE row locks; the role grants none of it (fail-closed); content serving is unaffected.
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
- [x] **Lot 4 — Namespace-local object store (s-conductor 2026-11-08; owner preprod secrets GO 01:58)**
  - [x] `artifact-object-store/`: ServiceAccount, Service :9000, StatefulSet (RustFS 1.0.4 digest-pinned, restricted pod, required root Secret, console off, 5Gi PVC), NetworkPolicy (ingress content + api on 9000, no egress), wired in `kustomization.yaml`.
  - [x] Bootstrap material in `deploy/ci/artifact-content/object-store/` (deployment-classified path): `iam/*.json` (content read on `artifacts`, builder cache read/write on `artifact-builder-cache`), `public-access-block.xml`, `artifact-content-db-role.sql`, `README.md` (bootstrap, rotation, rollback).
  - [x] Selftests: preprod store expectations (prod renders none) and deny cases (tag-only image, optional root credential, console, writable root, open ingress, cross-namespace, egress, missing store).
  - [x] Lot gate: `docker-slot.sh make test-artifact-content-manifests API_PORT=8846 UI_PORT=5246 MAILDEV_UI_PORT=1146 ENV=test-artifact-prep`.
