# Feature: BR-37 Deploy Sentropic to poc-k8s Kapsule tenant

## Objective
Lift the Sentropic api + ui + postgres + maildev stack onto the shared `poc-k8s` Scaleway Kapsule cluster as a tenant-scoped POC. Keep docker-compose for local dev and CI; this branch validates the Kubernetes deployment path, capacity envelope, image publication, and operator UAT only.

## Scope / Guardrails
- Scope limited to tenant manifests, image build workflow, operator Make targets, and UAT documentation.
- No app code changes.
- No database schema migration.
- No docker-compose replacement.
- No dev/CI migration to Kubernetes.
- BR-37 is separate from BR-14d: BR-37 owns the POC tenant workload and its POC SCW Container Registry image names; BR-14d owns DNS, production secrets transition, public hostnames, broader registry migration, and final Sentropic ops.
- Make-only workflow for this repo; no direct Docker commands.
- Root workspace is reserved for user dev/UAT on `ENV=dev` and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-deploy-poc-k8s`.
- Automated local gates, if needed, run on `ENV=test-feat-deploy-poc-k8s` or `ENV=e2e-feat-deploy-poc-k8s`, never on root `dev`.
- UAT qualification runs against the live `poc-k8s` tenant after image publication and must record cluster evidence in this file or `docs/uat/2026-05-16-deploy-poc-k8s.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text is English.
- Branch identity: BR-37, branch `feat/deploy-poc-k8s`, worktree `tmp/feat-deploy-poc-k8s`; recovered implementation commit `941fbf7c`.
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
  - `.github/workflows/build-and-push-images.yml` (`BR37-EX2`, deletion — redressement: duplicates `ci.yml` publish jobs)
  - `.github/workflows/ci.yml` (`BR37-EX4`, add `deploy-poc-k8s` job + amend `publish-{api,ui}-image` to push dual tag and SCW image name override)
  - `PLAN.md` (`BR37-EX3`, roadmap registration only)
  - `plan/37-BRANCH_feat-deploy-poc-k8s.md` (`BR37-EX3`, branch stub only)
- **Exception process**:
  - Declare exception ID `BR37-EXn` in `## Feedback Loop` before touching any conditional path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR37-EX1** (status: `accepted`): Conditional `Makefile` change for `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, and `scw-status`. Reason: the repo needs Make-only operator entrypoints for the tenant workload. Impact: append-only deploy/status/secret targets, no existing target behavior changed. Rollback: remove the appended `Scaleway Kapsule` Makefile block.
- **BR37-EX2** (status: `revoked`): The dedicated `.github/workflows/build-and-push-images.yml` was a design duplication of the existing `ci.yml` publish jobs. Removed during the 2026-05-19 BR37 redressement; image publish reuses the existing `publish-{api,ui}-image` jobs of `ci.yml` (SCW Registry path with `DOCKER_PASSWORD=SCW_SECRET_KEY`). Rollback: restore the deleted workflow from git history.
- **BR37-EX3** (status: `deferred`): Register BR-37 in `PLAN.md` and add `plan/37-BRANCH_feat-deploy-poc-k8s.md`. Reason: roadmap hygiene after recovery from stale `BRANCH.md`. Impact: docs-only. Rollback: revert roadmap/stub additions. Owner: conductor. Non-blocking for POC code; blocking for roadmap accuracy.
- **BR37-EX4** (status: `accepted`): Conditional `.github/workflows/ci.yml` change to add the `deploy-poc-k8s` job (rollout on Kapsule after `publish-api-image` + `publish-ui-image`) and amend the existing `publish-{api,ui}-image` jobs to override `API_IMAGE_NAME=sentropic-api` / `UI_IMAGE_NAME=sentropic-ui` and push a dual tag (sha1 content-hash + branch/main alias). Reason: aligns Kapsule rollout with the existing CD path, zero duplication. Impact: one new job + alias tag step on two existing jobs. Rollback: revert ci.yml changes.
- **BR37-FL1** (severity: `attention`, status: `open`): Cost target is intentionally not numeric in this branch. The recovered conversation confirms POC-only scope and the user challenged the cost-target question. Do not block live UAT on a numeric cost target.
- **BR37-FL2** (severity: `blocked`, status: `in-progress`): Live cluster UAT requires the SCW Registry pull-secret in the `sentropic` namespace, rollout healthy, api/ui/maildev smoke checks green. Pull path is provisioned **operator-side** via `make tenant-registry-secret TENANT=sentropic SCW_REGISTRY_TOKEN=<token>` in `~/src/poc-k8s/` (separate commit, separate repo). BR37 documents the prerequisite in `deploy/scw/README.md` and adds `imagePullSecrets: [{ name: sentropic-registry }]` on `ServiceAccount sentropic-app` in `deploy/scw/10-rbac.yaml`. The SCW IAM API key read-only on Registry is created via `scw iam api-key create`. Namespace/quota/baseline and secrets are already applied.
- **BR37-FL3** (severity: `fixed`, status: `closed`): Branch drift was resolved on 2026-05-17 by merging `origin/main` into `feat/deploy-poc-k8s`; PR #160 reports `mergeStateStatus=CLEAN` and CI green at head `3efe0d9b`.
- **BR37-FL4** (severity: `fixed`, status: `closed`): The next deploy target is confirmed as the Sentropic app workload from this BR-37 worktree. Do not use the remote control-plane repo for this UAT.
- **BR37-FL5** (severity: `fixed`, status: `closed`): Session `session-sess-apr95chl` is no longer wanted. Verification on 2026-05-17 returned `NotFound` for pod, PVC, and auth Secret, so no cleanup action remains.
- **BR37-FL6** (severity: `fixed`, status: `closed`): Manifests previously referenced static `v0.1.0` GHCR tags while the branch workflow publishes `feat-deploy-poc-k8s` and short-SHA tags. Fixed 2026-05-17 by pointing api/ui manifests at the branch tag for POC rollout. Rollback: retag a release image and update the manifest tags before production handoff.
- **BR37-FL7** (severity: `fixed`, status: `closed`): BR-37 intentionally consumes the Sentropic transition plan for POC deployment artifacts only. `TRANSITION.md` keeps the broad codebase/DNS/Scaleway rename under BR-14e/BR-14d, but the Kapsule UAT image pull gate needs final POC image names now. Fixed by publishing branch images as `ghcr.io/rhanka/sentropic-api` and `ghcr.io/rhanka/sentropic-ui`, updating manifests/docs, and leaving app-code, DNS, OAuth, dashboards, and broader Scaleway renames deferred.
- **BR37-FL8** (severity: `fixed`, status: `closed`): The image workflow originally used only the last ref path segment, so branch `feat/deploy-poc-k8s` published `deploy-poc-k8s` while manifests expected `feat-deploy-poc-k8s`. Fixed by deriving tags from `GITHUB_REF_NAME` and replacing `/` with `-`, keeping api/ui manifests aligned with the branch tag.
- **BR37-FL9** (severity: `attention`, status: `in-progress`): Design redressement on 2026-05-19. Image publish was duplicated between the BR37-specific `build-and-push-images.yml` (GHCR path) and the existing `ci.yml` publish jobs (SCW Registry path used for the legacy Scaleway Containers Service deploy). Decision: drop the duplicate workflow, reuse `publish-{api,ui}-image` of `ci.yml` with image name override `sentropic-{api,ui}` and dual tag push (sha1 content-hash + branch alias `feat-deploy-poc-k8s` during PR, then `main` post-merge). New `deploy-poc-k8s` job in `ci.yml` runs `kubectl rollout restart` on Kapsule after publish. Tag strategy: manifests reference the floating branch/main alias with `imagePullPolicy: Always` and no imperative `kubectl set image` or envsubst. Kubeconfig sourced from new GH secret `KUBECONFIG_POC_B64`. AI flaky `tests/03-chat.spec.ts` cleared by rerun on 2026-05-19 (CI run 26035260832 second attempt green; allowlist per `rules/testing.md:42`).
- **BR37-FL10** (severity: `attention`, status: `open`): SCW Container Registry host/namespace literal was not discoverable in the repo (no `rg.fr-par.scw.cloud` reference; `REGISTRY` comes from GH secret `secrets.REGISTRY`, opaque at code level). Manifests now hardcode `rg.fr-par.scw.cloud/sentropic/sentropic-{api,ui}:feat-deploy-poc-k8s` per the BR-37 Lot 2.5 launch packet assumption. Operator must confirm the GH `secrets.REGISTRY` value matches `rg.fr-par.scw.cloud/sentropic` before first CI publish; otherwise update both ci.yml `publish-{api,ui}-image` jobs (alias push uses `${REGISTRY}/${IMAGE_NAME}`) and the manifests' literal namespace segment. Rollback: replace the literal in `30-api.yaml`/`40-ui.yaml`.

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
  - [x] Confirm branch `feat/deploy-poc-k8s`, worktree `tmp/feat-deploy-poc-k8s`, recovered implementation commit `941fbf7c`.
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
  - [x] Align api/ui manifest tags with the branch image workflow tag `feat-deploy-poc-k8s`.
  - [x] Rename BR-37 POC GHCR artifacts from `top-ai-ideas-api/ui` to `sentropic-api/ui`; leave broader transition items to BR-14e/BR-14d.
  - [x] Preserve the full branch slug in GHCR image tags so `feat/deploy-poc-k8s` publishes `feat-deploy-poc-k8s`.

- [ ] **Lot 2.5 — CI/CD redressement (SCW Registry + Kapsule rollout)**
  - [x] Delete `.github/workflows/build-and-push-images.yml` (BR37-EX2 revoked).
  - [x] Amend `ci.yml` `publish-api-image` job with env override `API_IMAGE_NAME=sentropic-api` and a step that pushes a dual alias tag (`feat-deploy-poc-k8s` on branch, `main` on main).
  - [x] Amend `ci.yml` `publish-ui-image` job with the same pattern and `UI_IMAGE_NAME=sentropic-ui`.
  - [x] Add new job `deploy-poc-k8s` in `ci.yml` with `needs: [publish-api-image, publish-ui-image]`, branch-conditional, that loads kubeconfig from `KUBECONFIG_POC_B64` GH secret, runs `kubectl -n sentropic rollout restart deployment/api deployment/ui` and `kubectl rollout status` with timeout. (BR37-EX4)
  - [x] Patch `deploy/scw/30-api.yaml` to image `${SCW_REGISTRY_HOST}/sentropic-api:feat-deploy-poc-k8s` with `imagePullPolicy: Always`.
  - [x] Patch `deploy/scw/40-ui.yaml` to image `${SCW_REGISTRY_HOST}/sentropic-ui:feat-deploy-poc-k8s` with `imagePullPolicy: Always`.
  - [x] Patch `deploy/scw/10-rbac.yaml` to add `imagePullSecrets: [{ name: sentropic-registry }]` on ServiceAccount `sentropic-app`.
  - [ ] Update `deploy/scw/README.md` to replace GHCR references by SCW Registry and document operator prerequisite `make tenant-registry-secret TENANT=sentropic SCW_REGISTRY_TOKEN=<token>` in `~/src/poc-k8s/`.
  - [ ] User action: create SCW API key read-only on Registry via `scw iam api-key create` and provide the token to the operator.
  - [ ] User action: create GH secret `KUBECONFIG_POC_B64` (base64 of `~/.kube/poc.yaml`).
  - [ ] Operator action (out of BR37 repo): add `tenant-registry-secret` target in `~/src/poc-k8s/Makefile` and apply it once for the `sentropic` namespace.
  - [ ] At PR merge to main: edit manifests `:feat-deploy-poc-k8s` to `:main` and remove the branch alias from ci.yml publish steps.

- [ ] **Lot 3 — Live poc-k8s UAT**
  - [x] Confirm next deploy target is the Sentropic app workload from this BR-37 worktree.
  - [x] Verify obsolete session `session-sess-apr95chl` is already absent: pod, PVC, and auth Secret all return `NotFound`.
  - [x] Confirm `poc-k8s` operator side is applied: namespace `sentropic`, ResourceQuota, LimitRange, NetworkPolicy baseline.
  - [x] Bundle secrets from root `.env`: `sentropic-postgres` and `sentropic-api`.
  - [ ] Verify Kapsule pull-secret `sentropic-registry` exists in namespace via `kubectl -n sentropic get secret sentropic-registry`.
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
- [ ] Remaining production Scaleway object, secret, workflow, dashboard, DNS, OAuth, and residual codebase rename finalization.
