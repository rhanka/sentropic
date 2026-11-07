# fix: preserve production images by GHCR digest before A4

## Objective
- [x] Pin api, auth-idp and ui to their preserved live production GHCR digests before any production deployment; locally qualified and reviewed for one READY PR.

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
  - `scripts/ci/compatibility-classifier.mjs`
  - `scripts/ci/compatibility-classifier.test.mjs`
  - `scripts/ci/consumer-boundaries.json`
  - `scripts/ci/consumer-contracts.mjs`
  - `scripts/ci/consumer-contracts.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/base/**` only if a remaining pull-secret reference is found.

## Feedback Loop
- [x] BR936-EX1 (owner-requested CI repair): allow ci.yml global-filter coverage for BR-83 policy edits; impact: policy edits select full integration; rollback: remove these filter entries with the classifier repair.
- [x] CI run 42339681690, job 128304466738: deployment manifests were classified runtime-security, requiring unselected application suites; add a manifest-only classification with mandatory manifest validation and unchanged installed tuples.
- [x] ROOT-CAUSE: prod inherits GHCR main aliases; Always would resolve A4 code without the prod A4 checkpoint. API and auth-idp run different manifest digests and require separate deployment pins.
- [x] Live read-only snapshot 2026-11-07T04:36:37.804Z: api-5c56d8ffb7-7m8nf, auth-idp-5cd7858b5-bwds5 and ui-777fc875b4-chtvx are ready; digest equality and anonymous GHCR verification are required before handoff.
- [x] Anonymous GHCR manifest byte hashes equal the live Pod imageIDs: api sha256:19b11b5baffe6b2e743ef6d5bb33e5fdb5ee78fe0e97573c51c37fa2d44e7ad7; auth-idp sha256:a36c6acaf9c887b4e96e54897f4d8f701456524a7c89976211786b680e543909; ui sha256:1f33dd0cde7733d2061f02ab1a5a14eb1a6276ce99001c697f5c697e2c0c9d4e. The three existing workloads retain byte-identical code; only the registry changes.
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
- [x] **CI repair**: classifier regression failed before the fix; 19 classification, 24 consumer, 10 tuple and 41 real-workflow tests PASS through Make. Exact run-4510 dispatch replay PASS with deployment-only selection, required manifest validation and unchanged tuples. Policy edits select full integration. Conductor imports this request and .tmp/rv/fix-936-931.md into Track.
- [x] **Lot 0 — Evidence**: common/master/workflow/testing rules, isolated branch, mechanical harness branch check, production pods read-only, existing pull-secret cleanup confirmed.
- [x] **Lot 1 — Pin and regression**: deployment-specific digests with removal trigger; rendered-overlay exact pins and 12 mutable-tag rejection cases for api/auth-idp/ui; both rendered tiers reject pull secrets; artifact-content activation and preprod checks preserved.
- [x] **Lot 2 — Verify**: make test-artifact-content-manifests API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-prod-ghcr-pin PASS: 71 artifact checks, 31 A4 operator tests, recovery/custody/rendered ingress sequence checks. Anonymous GHCR proof and mechanical branch/scope gates PASS; two independent Astra xhigh code reviews PASS on implementation diff d5287e63449adbf80adae0618384e37aafd8fe20545bd3d5329e9f438366e8e9.
- [ ] **Lot 3 — Handoff**: final make commit, make down-volumes ENV=test-prod-ghcr-pin, push, one READY PR, exact gated prod command in PR body, .tmp/rv/prod-ghcr-pin.md; exit without polling CI. Conductor owns CI observation, merge and Track import.
