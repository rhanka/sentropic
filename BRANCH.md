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
- [ ] Final validation: push #1001 and exact-head green CI; no merge.
