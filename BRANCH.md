# Feature: Reconcile T3 production A4 IaC pins and convergence
## Objective
- [ ] Correct #1001 against the merged driver and publication receipts; no cluster actions or merge.
## Scope / Guardrails
- [x] Rebased `feat/t3-prod-a4-iac` on `origin/main` at `c95ca6bb9`; only BRANCH.md conflicted; deployment corrections replayed without a source conflict, targeted rendered-bundle and 3/3 IaC checks pass on this base.
- [x] Worktree `tmp/t3-prod-a4-iac`; ENV=test-t3-iac, ports API 9166 / UI 5366 / Maildev 1266.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
  - `deploy/ci/artifact-content/tests.mk`
  - `deploy/ci/preprod-a4/t3-iac.test.mjs`
  - `deploy/k8s/components/a4-wiring/patch-api-a4.yaml`
  - `deploy/k8s/components/a4-wiring/patch-auth-idp-a4.yaml`
  - `deploy/k8s/overlays/prod-a4/kustomization.yaml`
  - `scripts/test-k8s-bundle-secret.sh`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
## Feedback Loop
- [x] BR1001-EX1: Makefile prod-a4 switch authorized by packet; remove forced restart and block generic secret regeneration. Impact: explicit pod-template convergence required. Rollback: revert this branch before apply.
- [x] BR1001-EX2: main c95ca6bb9 adds generic secret validator regressions; first verify the real T3 refusal before absent input/zero stub calls, then run every original validator case on a private Makefile copy with only the freeze line removed. No operator bypass or weakened assertion; rollback reverts the test adaptation.
- [ ] P-0.8: operator must prove exact pod-template and key parity before convergence; no runtime evidence claimed.
- [x] CI failure 43545717439: scoped content-test container omitted Makefile required by the new IaC tests; mount it read-only, preserving all assertions.
- [x] R6 packet (rehearsal r8, P-0.8 non-zero diff) allows `deploy/**`: the two A4 wiring patches are byte-identical to the driver branch `fix/t3-driver-gaps` (sha256 c2f1d457…4e69 and a674058b…a92e), so both branches merge without conflict and this render is the one the fenced wire reproduces.
- [x] R6 render effect: env, volume and mount order unchanged against head a24fbba71; the only pod-template addition is the API pod affinity (weight 100) toward the tenant database node. The canonical-diff gate and the operator judge live on the driver branch.
- [x] R6 regression: `t3-iac.test.mjs` requires the restated base entries in base order, the IdP session volume and mount, and the placement preference; red on the previous wiring (172/173), green now (173/173).
- [x] R8 packet (k8s PriorityClass `sentropic-t3-critical`, value 100000, preemptionPolicy Never, acts only on pods naming it): `overlays/prod-a4` names it on the api, auth-idp and ui pod templates, the pods the window recreates. The file is byte-identical to the driver branch `fix/t3-driver-gaps` (sha256 6acc5791…e945), whose fenced wire sets the same field on the live templates and whose P-0.8 gate requires a zero diff; both branches must merge together.
- [x] R8 regression: `t3-iac.test.mjs` (target and class in the overlay, no other tier) and the rendered check in `bundle.selftest.mjs` (prod-a4 names the class on the three Deployments only; no StatefulSet, CronJob or other tier); red on the previous overlay, green now (174/174 and the rendered selftests).
- [ ] R8 for k8s: the class must exist for as long as prod-a4 names it; a pod naming a missing class is refused at creation.
- [ ] R8 finding for the operator: this overlay pins the database to `postgres@sha256:266d3c25…` (17.11, the live pod imageID) while the live StatefulSet names `postgres:17-alpine`; the apply changes the image string and restarts `postgres-0` on the same bytes. P-0.8 judges the three Deployments only.
## AI Flaky tests
- [x] None.
## Orchestration Mode (AI-selected)
- [x] Multi-branch: separate driver gap branch, no merge authorized.
## UAT Management (in orchestration context)
- [ ] Operator qualifies isolated fixture and final pod templates.
## Plan / Todo (lot-based)
- [x] Lot 0: rebase and mechanically verify branch.
- [x] Lot 1: UI digest corrected, API/auth-idp T2 digest retained, unconditional restart removed, generic secret target frozen; regression tests added.
- [x] Local validation: standalone Kustomize 5.7.1 renders prod/preprod/prod-a4/preprod-a4; bundle/topology checks and three IaC regression tests pass.
- [x] Lot R6: A4 wiring aligned with the driver wire; `ENV=test-t3-r6`, API 9168, UI 5368, Maildev 1268; rendered-bundle gate 173/173 and identity-sync selftest 74 PASS.
- [x] Lot R8: T3 priority class on the prod-a4 pod templates; `ENV=test-t3-r8`, API 9170, UI 5370, Maildev 1270, checked free; rendered-bundle gate 174/174.
- [ ] Final validation: push #1001 and exact-head green CI; no merge.
