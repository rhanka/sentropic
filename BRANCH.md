# Feature: BR-37 Deploy Sentropic to poc-k8s Kapsule tenant

## Objective
Lift the Sentropic api + ui + postgres + maildev stack onto the shared `poc-k8s` Scaleway Kapsule cluster as a tenant-scoped POC. Keep docker-compose for local dev and CI; this branch validates the Kubernetes deployment path, capacity envelope, image publication, and operator UAT only.

## Scope / Guardrails
- Scope limited to tenant manifests, image build workflow, operator Make targets, and UAT documentation.
- No app code changes.
- No database schema migration.
- No docker-compose replacement.
- No dev/CI migration to Kubernetes.
- BR-37 is separate from BR-14d: BR-37 owns the POC tenant workload; BR-14d owns DNS, production secrets transition, public hostnames, registry renames, and final Sentropic ops.
- Make-only workflow for this repo; no direct Docker commands.
- Root workspace is reserved for user dev/UAT on `ENV=dev` and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-deploy-poc-k8s`.
- Automated local gates, if needed, run on `ENV=test-feat-deploy-poc-k8s` or `ENV=e2e-feat-deploy-poc-k8s`, never on root `dev`.
- UAT qualification runs against the live `poc-k8s` tenant after image publication and must record cluster evidence in this file or `docs/uat/2026-05-16-deploy-poc-k8s.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text is English.
- Branch identity: BR-37, branch `feat/deploy-poc-k8s`, worktree `tmp/feat-deploy-poc-k8s`, current HEAD `941fbf7c`.
- Local slot 0 ports, only for local gates if needed: API `9185`, UI `5385`, Maildev `1285`.
- Live k8s UAT uses `KUBECONFIG=$HOME/.kube/poc.yaml` and temporary port-forwards for api/ui/maildev.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/scw/**`
  - `docs/uat/2026-05-16-deploy-poc-k8s.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `e2e/**`
  - `rules/**`
  - `spec/**`
  - `.cursor/rules/**`
  - `TRANSITION.md`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`BR37-EX1`, append-only `scw-*` targets)
  - `.github/workflows/build-and-push-images.yml` (`BR37-EX2`, new image workflow only)
  - `PLAN.md` (`BR37-EX3`, roadmap registration only)
  - `plan/37-BRANCH_feat-deploy-poc-k8s.md` (`BR37-EX3`, branch stub only)
- **Exception process**:
  - Declare exception ID `BR37-EXn` in `## Feedback Loop` before touching any conditional path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR37-EX1** (status: `accepted`): Conditional `Makefile` change for `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, and `scw-status`. Reason: the repo needs Make-only operator entrypoints for the tenant workload. Impact: append-only deploy/status/secret targets, no existing target behavior changed. Rollback: remove the appended `Scaleway Kapsule` Makefile block.
- **BR37-EX2** (status: `accepted`): Conditional GitHub workflow `.github/workflows/build-and-push-images.yml`. Reason: Kapsule needs published production images for api and ui. Impact: branch/main/tag image builds to GHCR. Rollback: delete the workflow.
- **BR37-EX3** (status: `deferred`): Register BR-37 in `PLAN.md` and add `plan/37-BRANCH_feat-deploy-poc-k8s.md`. Reason: roadmap hygiene after recovery from stale `BRANCH.md`. Impact: docs-only. Rollback: revert roadmap/stub additions. Owner: conductor. Non-blocking for POC code; blocking for roadmap accuracy.
- **BR37-FL1** (severity: `attention`, status: `open`): Cost target is intentionally not numeric in this branch. The recovered conversation confirms POC-only scope and the user challenged the cost-target question. Do not block live UAT on a numeric cost target.
- **BR37-FL2** (severity: `blocked`, status: `open`): Live cluster UAT still requires operator evidence: namespace/quota/baseline applied, GHCR image pull path public or pull-secreted, secrets bundled, rollout healthy, api/ui/maildev smoke checks green.
- **BR37-FL3** (severity: `attention`, status: `open`): Current branch is `ahead 1` and `behind 140` versus `origin/main`. Before merge, re-check PR #160 against current `origin/main` and resolve any drift from BR-14b/PR #163 and later merges.

## AI Flaky tests
- Not applicable. This branch does not change AI runtime behavior.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one infrastructure POC with tightly coupled manifests, workflow, Make targets, and UAT docs; independent sub-branches would add coordination without reducing risk.

## UAT Management (in orchestration context)
- Mono-branch. UAT happens against the live `poc-k8s` cluster after PR image publication.
- Root dev/UAT remains reserved for user dev on `ENV=dev`.
- Docker-compose dev/CI remains unchanged.
- Operator-side prerequisites live in `~/src/poc-k8s`, not in this repo.
- Merge gate:
  - [ ] PR CI is green after `BRANCH.md` repair.
  - [ ] Live Kapsule UAT passed, or explicit user waiver recorded.
  - [ ] Rollback path `make scw-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` is verified or waived.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & recovery**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`, `rules/testing.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm branch `feat/deploy-poc-k8s`, worktree `tmp/feat-deploy-poc-k8s`, HEAD `941fbf7c`, clean worktree.
  - [x] Confirm tracking branch `origin/feat-deploy-poc-k8s`, ahead/behind `0/0`.
  - [x] Confirm branch diff against `origin/main`: 10 files, 689 insertions, app code untouched.
  - [x] Identify stale `BRANCH.md` content from `fix/security-remaining-vulns`.
  - [x] Recover conversation intent: register as BR-37, POC k8s only, docker-compose remains dev/CI, BR-14d keeps final ops.
  - [x] Replace stale `BRANCH.md` with this BR-37 contract.

- [x] **Lot 1 — Tenant manifests**
  - [x] Add `deploy/scw/10-rbac.yaml` namespace-scoped ServiceAccount.
  - [x] Add `deploy/scw/20-postgres.yaml` Postgres 17 StatefulSet, headless Service, 1Gi `scw-bssd` PVC, and ConfigMap.
  - [x] Add `deploy/scw/30-api.yaml` api Deployment, ClusterIP Service on port 8787, non-secret ConfigMap, and `sentropic-api` Secret references.
  - [x] Add `deploy/scw/40-ui.yaml` ui Deployment and ClusterIP Service on port 5173.
  - [x] Add `deploy/scw/50-maildev.yaml` dev SMTP capture Deployment and ClusterIP Service.
  - [x] Add optional `deploy/scw/60-ingress.yaml` with placeholder hosts and `SCW_INGRESS=1`.
  - [x] Document that namespace, ResourceQuota, LimitRange, and NetworkPolicy are owned by `poc-k8s/tenants/sentropic`, not this repo.

- [x] **Lot 2 — Images, Make targets, docs**
  - [x] Add `.github/workflows/build-and-push-images.yml` for api/ui production image builds to GHCR on tags, `main`, `feat/deploy-poc-k8s`, and manual dispatch.
  - [x] Add append-only `Makefile` targets: `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-status`.
  - [x] Add `deploy/scw/README.md` with operator prerequisites, secret bundle, deploy, smoke, pause/resume, and cleanup notes.
  - [x] Add `docs/uat/2026-05-16-deploy-poc-k8s.md` with live UAT checklist and known limitations.
  - [x] Confirm PR #160 CI/checks were reported green by recovered GitHub context, including image jobs.

- [ ] **Lot 3 — Live poc-k8s UAT**
  - [ ] Confirm `poc-k8s` operator side is applied: namespace `sentropic`, ResourceQuota, LimitRange, NetworkPolicy baseline.
  - [ ] Confirm GHCR api/ui image pull path: packages public or namespace pull secret configured.
  - [ ] Bundle secrets: `make scw-bundle-secret KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
  - [ ] Deploy workload: `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
  - [ ] Snapshot workload: `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
  - [ ] Port-forward api via `poc-k8s` Make target and verify `/api/v1/health`.
  - [ ] Port-forward ui via `poc-k8s` Make target and verify `/`.
  - [ ] Port-forward maildev via `poc-k8s` Make target and verify the UI.
  - [ ] Record quota usage and whether it remains within tenant budget.
  - [ ] Record evidence in `docs/uat/2026-05-16-deploy-poc-k8s.md` or this file.

- [ ] **Lot N — Final validation**
  - [ ] Refresh PR #160 body from this `BRANCH.md`.
  - [ ] Re-check PR CI after `BRANCH.md` repair.
  - [ ] Re-check drift against current `origin/main`.
  - [ ] Record live UAT result and rollback decision.
  - [ ] If UAT + CI are both OK, commit removal of `BRANCH.md`, push, and merge.

## Deferred to BR-14d / BR-37 follow-ups
- [ ] Sealed Secrets / Vault.
- [ ] Postgres backup automation.
- [ ] Real outbound SMTP.
- [ ] Public DNS.
- [ ] Cert-manager ClusterIssuer and final Ingress hosts.
- [ ] Full dev/CI migration to Kubernetes or k3d.
- [ ] Scaleway object, registry, secret, workflow, and dashboard rename finalization.
