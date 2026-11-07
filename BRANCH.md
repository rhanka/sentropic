# fix: preserve production images by GHCR digest before A4

## Objective
- [ ] Pin api, auth-idp and ui to their preserved live production GHCR digests before any production deployment; open one READY PR and exit.

## Scope / Guardrails
- [x] Branch fix/prod-ghcr-pin from origin/main 17ad1c58b06a01b4f8e77472fa0421b9c507104a; worktree tmp/worktrees/prod-ghcr-pin.
- [x] ENV=test-prod-ghcr-pin; API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595; no service stack or local image build (disk 94%).
- [x] Make-only; ENV last; no Python, CI polling, deployment, merge, skip marker or attribution trailer.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in .security/ci-lockfile-policy.json.
- [x] Track source artifact: conductor is the designated .track writer; import this owner request, lots, decisions and .tmp/rv/prod-ghcr-pin.md from this branch.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/base/**` only if a remaining pull-secret reference is found.

## Feedback Loop
- [x] ROOT-CAUSE: prod inherits GHCR main aliases; Always would resolve A4 code without the prod A4 checkpoint. API and auth-idp run different manifest digests and require separate deployment pins.
- [x] Live read-only snapshot 2026-11-07T04:36:37.804Z: api-5c56d8ffb7-7m8nf, auth-idp-5cd7858b5-bwds5 and ui-777fc875b4-chtvx are ready; digest equality and anonymous GHCR verification are required before handoff.
- [x] Postgres pull-secret cleanup is already present in origin/main; deploy/k8s contains no imagePullSecrets or sentropic-registry references. Historical baseline evidence is retained.
- [x] Scope: pin the three existing production deployments; artifact-content and the suspended identity-export job retain their separate image references. Owner must review the complete render before GO.
- [x] Update the existing A4 manifest gate that explicitly expected prod main tags to assert the three preserved digests instead; keep prod checkpoint/runtime isolation assertions intact.

## AI Flaky tests
- [x] No exceptions, retries, increased timeouts or weakened safety assertions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch safety fix; independent code review and one READY PR.

## UAT Management (in orchestration context)
- [ ] Require the owner's GO before the cluster operator deploys the merged checkout with `make k8s-deploy KUBECONFIG=<approved-prod-kubeconfig-file> ENV=prod-release`.
- [x] This lane never runs that command; merging or publishing alone does not change running production pods.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**: common/master/workflow/testing rules, isolated branch, mechanical harness branch check, production pods read-only, existing pull-secret cleanup confirmed.
- [ ] **Lot 1 — Pin and regression**: deployment-specific digests with removal trigger; rendered-overlay positive and negative tests for api/auth-idp/ui; preserve artifact-content activation and preprod checks.
- [ ] **Lot 2 — Verify**: make test-artifact-content-manifests; anonymous GHCR manifest byte hashes equal live imageIDs; review and mechanical branch/scope gates; make down-volumes ENV=test-prod-ghcr-pin.
- [ ] **Lot 3 — Handoff**: atomic make commits, push, one READY PR, exact gated prod command in PR body, .tmp/rv/prod-ghcr-pin.md; exit without polling CI. Conductor owns CI observation, merge and Track import.
