# Feature: W3.d default-closed artifact content infrastructure

## Objective
- [ ] Deliver the content Kubernetes workload and isolated TLS routes without activating artifacts or accessing any cluster.

## Scope / Guardrails
- [x] Source: `.tmp/app-switch-week/plan-v2.md` W3.d and sections 3, 4, 5; W0 host-fit/reservations and W3.c inherited.
- [x] Base `origin/feat/app-cm-integration` at `763bb9d7e`; branch `feat/app-cm-w3d`; worktree `tmp/worktrees/app-w3d`.
- [x] Make-only; shared Docker flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; no parallel builds.
- [x] Every make command ends with `ENV=test-app-w3d`; ports API=8806, UI=5192, Maildev=1099.
- [x] No cluster operations, production activation, Python, rebase, force-push, AI trailers or destructive cleanup.
- [x] Serving, reader activation and host publication remain explicitly disabled before FIRST-IMMO, including main auto-deploys.
- [x] API remains the sole migration executor; content starts only the compiled content entrypoint.
- [x] Atomic commits under 150 changed lines; selective staging; `make commit` only.
- [x] External DNS/TLS/IAM/storage provisioning and positive live activation belong to tenant/W3.e/W5 lanes.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/artifact-content-*.yaml`
  - `deploy/k8s/base/kustomization.yaml`
  - `deploy/k8s/base/30-api.yaml`
  - `deploy/k8s/overlays/{preprod,prod}/kustomization.yaml`
  - `deploy/k8s/overlays/{preprod,prod}/artifact-content-*.yaml`
  - `deploy/k8s/overlays/{preprod,prod}/patch-artifact-content-config.yaml`
  - `deploy/ci/artifact-content/**`
  - `docs/runbooks/app-artifact-content-infrastructure.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/**`
  - `api/drizzle/**`
  - `.track/**`
  - `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- [x] **Exception process**: BR-CM-W3-EX1 below is the bounded inherited T3 build/deploy exception.

## Feedback Loop
- [x] BR-CM-W3-EX1 / acknowledged by owner W3.d packet and W0 reservations: add a render-only Make target/include and CI invocation. Impact: offline qualification only; rollback: remove include/step and content resources, retain closed flags. No deploy target execution or general CI refactor.
- [x] Tenant handoff: DNS/TLS provisioning, dedicated namespace-local credentials, private bucket checkpoint/restore and actual accepted image digest remain external receipts; document exact gates without asserting live readiness.

## AI Flaky tests
- [x] No AI tests or flaky exception selected; deterministic manifest and denial checks only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; merge integration updates only; no cherry-picks or rebase.

## UAT Management (in orchestration context)
- [x] Offline manifest inspection and local denial checks only; no root dev services or live browser activation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/testing, template, plan W3.d/dependencies/ownership, W0 reservations, W3.c entrypoint and image tests.
  - [x] Create isolated worktree and pass mechanical `harness check branch` before work.
  - [x] Freeze scope, exception, environment and ports; leave other lanes untouched.
- [ ] **Lot 1 — Tests first**
  - [ ] Add `deploy/ci/artifact-content/{tests.mk,bundle-checks.mjs,bundle.selftest.mjs}`.
  - [ ] Prove red: missing content resources; then render both full overlays without kubeconfig/network access.
  - [ ] Test closed gates despite enabled secret values, least privilege, network peer namespace isolation, both TLS wildcard depths and exact app route precedence.
  - [ ] Test synthetic digest replacement across API/IdP/content, unchanged backup/restore access and mutation denials.
- [ ] **Lot 2 — Workload and default closure**
  - [ ] Add content Deployment/Service/ConfigMap/NetworkPolicies and base registration; pin API gate env values explicitly.
  - [ ] Dedicated unprivileged ServiceAccount, read-only root, bounded resources/probes, no migration command or broad app secret.
  - [ ] Keep storage egress closed pending tenant-specific network/IAM receipts; health can run without secrets.
- [ ] **Lot 3 — Environment routes and certificates**
  - [ ] Add prod/preprod content ingress, explicit Certificate and domain patches/registrations.
  - [ ] Both stable and pinned wildcard SANs, dedicated TLS secret, HTTPS-only route; no catch-all/identity headers.
- [ ] **Lot 4 — Handoff and final validation**
  - [ ] Document tenant DNS/TLS/storage/restore/digest evidence and FIRST-IMMO activation gate in runbook.
  - [ ] Pass `make test-artifact-content-manifests API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`.
  - [ ] Pass inherited IdP parent-overlay regression and W3.c static image checks as applicable.
  - [ ] Complete independent review, scope check and diff inspection; address blocking findings.
  - [ ] Create draft PR against `feat/app-cm-integration` using this file; push and verify CI on exact final head.
  - [ ] Run locked `make down ENV=test-app-w3d` and confirm no services remain.
