# Feature: W3.d default-closed artifact content infrastructure

## Objective
- [x] Deliver the content Kubernetes workload and isolated TLS routes without activating artifacts or accessing any cluster.

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
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/prod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`
  - `deploy/k8s/overlays/prod/patch-artifact-content-config.yaml`
  - `deploy/ci/artifact-content/**`
  - `deploy/ci/idp-identity-sync/workflow.selftest.mjs`
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
  - `.github/workflows/app-cm-w3d.yml`
- [x] **Exception process**: BR-CM-W3-EX1 below is the bounded inherited T3 build/deploy exception.

## Feedback Loop
- [x] BR03d-EX2 / owner acknowledgment: PR #814 correction request (2026-10-28), Opus r1 P2-2. Defer actual release digest to W5; existing prod `:main` and CD content-hash `newTag` remain acceptable only while all three API/content flags are explicitly `0` (health/denial, no private serving). Impact: closed workloads run registry tags until W5; render gate rejects any flag `1` without SHA-256 digest-pinned API/content images. Rollback: keep all flags `0` and restore the prior qualified image/config; W5 replaces tags with the tested published digest before any opening.
- [x] BR03d-EX1 (mechanical alias of BR-CM-W3-EX1) / acknowledged by owner W3.d packet and W0 reservations: add a render-only Make target/include and CI invocation. Impact: offline qualification only; rollback: remove include/step and content resources, retain closed flags. No deploy target execution or general CI refactor.
- [x] Tenant handoff: DNS/TLS provisioning, dedicated namespace-local credentials, private bucket checkpoint/restore and actual accepted image digest remain external receipts; document exact gates without asserting live readiness.
- [x] BR03d-EX1 includes `.github/workflows/app-cm-w3d.yml`: shared CI excludes this app integration base; mirror W3.c's topic workflow for exact-head offline checks. Conductor removes topic workflows before main integration; rollback removes this topic workflow only.
- [x] BR03d-EX1 receiving-test seam: update only the exact expected CI command list in `deploy/ci/idp-identity-sync/workflow.selftest.mjs`. Evidence: first topic CI passes manifests then rejects the new content step in that list. Preserve the exact-order assertion and all IdP controls; rollback removes the expectation with the CI step.

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
- [x] **Lot 1 — Tests first**
  - [x] Add `deploy/ci/artifact-content/{tests.mk,bundle-checks.mjs,bundle.selftest.mjs,network.selftest.mjs}`.
  - [x] Prove red: rendered overlays fail `Deployment/artifact-content must occur once` (0 vs 1), before any content manifest exists.
  - [x] Test closed gates despite enabled secret values, least privilege, network peer namespace isolation, both TLS wildcard depths and exact app route precedence.
  - [x] Test synthetic digest replacement across API/IdP/content, unchanged backup/restore access and mutation denials; Kustomize renders digest-only identity (drops the source tag).
  - [x] Opus r1 P2-2: independently exercise every enabling flag on API/content against tagged and digest renders; reject malformed digests without weakening the default-closed gate.
- [x] **Lot 2 — Workload and default closure**
  - [x] Add content Deployment/Service/ConfigMap/NetworkPolicies and base registration; pin API gate env values explicitly.
  - [x] Dedicated unprivileged ServiceAccount, read-only root, bounded resources/probes, no migration command or broad app secret.
  - [x] Keep storage egress closed pending tenant-specific network/IAM receipts; health can run without secrets.
- [x] **Lot 3 — Environment routes and certificates**
  - [x] Add prod/preprod content ingress with ingress-shim annotations and domain patches/registrations; CD emits no Certificate requiring deployer writes (Opus r1 P2-1).
  - [x] Both stable and pinned wildcard SANs, dedicated TLS secret, HTTPS-only route; no catch-all/identity headers.
- [ ] **Lot 4 — Handoff and final validation**
  - [x] Document tenant DNS/TLS/storage/restore/digest evidence and FIRST-IMMO activation gate in runbook.
  - [x] Opus r1 P3-1/P3-2/P3-3: document wildcard overlap/automatic issuance, test the real parser's reserved-label denials, and restrict signing-key projection to `0440` with `fsGroup: 1000`.
  - [x] Pass `make test-artifact-content-manifests API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`: 54 checks covering ingress-shim, digest-opening mutations, key permissions, host parser and existing network/restore controls.
  - [x] Pass inherited IdP parent-overlay regression (47 checks) and W3.c static image checks (canonical hash `eeb755`, API/content-only invalidation, filters, compilation/copy).
  - [x] Mechanical scope checks and whitespace/diff inspection pass; exception uses BR03d-EX1 and explicit overlay paths.
  - [x] Independent receiving review received: Opus r1 at `.h2a/reviews/pr814_opus_r1.md`, head `e6b59ccd0`, CHANGES (P2-1/P2-2); author corrections supplied here. Conductor owns receiving acceptance of the corrected head; no new review consensus claimed.
  - [x] Create draft PR #814 against `feat/app-cm-integration` using this file; final pushed-head CI receipt is recorded in its validation comment. First green run: `40644234492` at `fb170161b29870b439d1e5f36822ab351d3d9e42`.
  - [x] Run locked `make down ps API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`: no services remain.
