# Feature: BR-37 Deploy Sentropic to shared Kubernetes tenant

## Objective
Lift the Sentropic api + ui + postgres + maildev stack onto the shared `poc-k8s` Scaleway Kubernetes cluster as a tenant-scoped POC. Keep docker-compose for local dev and CI; this branch validates the Kubernetes deployment path, capacity envelope, image publication, and operator UAT only.

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
  - `Makefile` (`BR37-EX1`, append-only `scw-*` targets; `BR37-EX5`, append-only `gh-k8s-*` operator helpers and neutral k8s block naming)
  - `.github/workflows/build-and-push-images.yml` (`BR37-EX2`, deletion — redressement: duplicates `ci.yml` publish jobs)
  - `.github/workflows/ci.yml` (`BR37-EX4`, add branch push trigger + `deploy-k8s` job + amend `publish-{api,ui}-image` to push dual tag and SCW image name override)
  - `PLAN.md` (`BR37-EX3`, roadmap registration only)
  - `plan/37-BRANCH_feat-deploy-poc-k8s.md` (`BR37-EX3`, branch stub only)
- **Exception process**:
  - Declare exception ID `BR37-EXn` in `## Feedback Loop` before touching any conditional path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR37-EX1** (status: `accepted`): Conditional `Makefile` change for `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-registry-secret`, `scw-status`, `scw-debug`, `scw-logs`, and `scw-smoke`. Reason: the repo needs Make-only operator entrypoints for the tenant workload and live UAT diagnostics. Impact: append-only deploy/status/secret/debug/smoke targets, no existing target behavior changed. Rollback: remove the appended `Scaleway Kubernetes` Makefile block.
- **BR37-EX2** (status: `revoked`): The dedicated `.github/workflows/build-and-push-images.yml` was a design duplication of the existing `ci.yml` publish jobs. Removed during the 2026-05-19 BR37 redressement; image publish reuses the existing `publish-{api,ui}-image` jobs of `ci.yml` (SCW Registry path with `DOCKER_PASSWORD=SCW_SECRET_KEY`). Rollback: restore the deleted workflow from git history.
- **BR37-EX3** (status: `deferred`): Register BR-37 in `PLAN.md` and add `plan/37-BRANCH_feat-deploy-poc-k8s.md`. Reason: roadmap hygiene after recovery from stale `BRANCH.md`. Impact: docs-only. Rollback: revert roadmap/stub additions. Owner: conductor. Non-blocking for POC code; blocking for roadmap accuracy.
- **BR37-EX4** (status: `accepted`): Conditional `.github/workflows/ci.yml` change to add the `feat/deploy-poc-k8s` push trigger, add the neutral `deploy-k8s` job (rollout on the Kubernetes tenant after `publish-api-image` + `publish-ui-image`), and amend the existing `publish-{api,ui}-image` jobs to override `API_IMAGE_NAME=sentropic-api` / `UI_IMAGE_NAME=sentropic-ui` and push a dual tag (sha1 content-hash + branch/main alias). Reason: aligns Kubernetes rollout with the existing CD path, zero duplication, and enables pre-merge UAT on the branch. Impact: one branch push trigger, one new job, and alias tag step on two existing jobs. Rollback: revert ci.yml changes.
- **BR37-EX5** (status: `accepted`): Conditional `Makefile` change for `gh-k8s-secret`, `gh-k8s-secret-check`, `gh-k8s-rerun-deploy`, `gh-k8s-watch`, and neutral `Scaleway Kubernetes` block naming. Reason: encode the operator path for creating `KUBECONFIG_B64` and monitoring the deploy run without relying on chat history or ad hoc shell commands. Impact: append-only GitHub CLI helper targets; no secret value is printed or written to disk. Rollback: remove the `gh-k8s-*` targets and restore the previous block heading.
- **BR37-FL1** (severity: `attention`, status: `open`): Cost target is intentionally not numeric in this branch. The recovered conversation confirms POC-only scope and the user challenged the cost-target question. Do not block live UAT on a numeric cost target.
- **BR37-FL2** (severity: `fixed`, status: `closed`): Live cluster UAT requires the SCW Registry pull-secret in the `sentropic` namespace, rollout healthy, api/ui/maildev smoke checks green. Fixed on 2026-05-20 by adding `make scw-registry-secret` in this repo, creating `sentropic-registry` from `REGISTRY`, `DOCKER_USERNAME`, and `DOCKER_PASSWORD` in the root `.env`, applying workload NetworkPolicies for the tenant default-deny baseline, and passing `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`. Rollback: `make scw-undeploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
- **BR37-FL3** (severity: `fixed`, status: `closed`): Branch drift was resolved on 2026-05-17 by merging `origin/main` into `feat/deploy-poc-k8s`; PR #160 reports `mergeStateStatus=CLEAN` and CI green at head `3efe0d9b`.
- **BR37-FL4** (severity: `fixed`, status: `closed`): The next deploy target is confirmed as the Sentropic app workload from this BR-37 worktree. Do not use the remote control-plane repo for this UAT.
- **BR37-FL5** (severity: `fixed`, status: `closed`): Session `session-sess-apr95chl` is no longer wanted. Verification on 2026-05-17 returned `NotFound` for pod, PVC, and auth Secret, so no cleanup action remains.
- **BR37-FL6** (severity: `fixed`, status: `closed`): Manifests previously referenced static `v0.1.0` GHCR tags while the branch workflow publishes `feat-deploy-poc-k8s` and short-SHA tags. Fixed 2026-05-17 by pointing api/ui manifests at the branch tag for POC rollout. Rollback: retag a release image and update the manifest tags before production handoff.
- **BR37-FL7** (severity: `fixed`, status: `closed`): BR-37 intentionally consumes the Sentropic transition plan for POC deployment artifacts only. `TRANSITION.md` keeps the broad codebase/DNS/Scaleway rename under BR-14e/BR-14d, but the Kubernetes UAT image pull gate needs final POC image names now. Fixed by publishing branch images as `ghcr.io/rhanka/sentropic-api` and `ghcr.io/rhanka/sentropic-ui`, updating manifests/docs, and leaving app-code, DNS, OAuth, dashboards, and broader Scaleway renames deferred.
- **BR37-FL8** (severity: `fixed`, status: `closed`): The image workflow originally used only the last ref path segment, so branch `feat/deploy-poc-k8s` published `deploy-poc-k8s` while manifests expected `feat-deploy-poc-k8s`. Fixed by deriving tags from `GITHUB_REF_NAME` and replacing `/` with `-`, keeping api/ui manifests aligned with the branch tag.
- **BR37-FL9** (severity: `attention`, status: `in-progress`): Design redressement on 2026-05-19. Image publish was duplicated between the BR37-specific `build-and-push-images.yml` (GHCR path) and the existing `ci.yml` publish jobs (SCW Registry path used for the legacy Scaleway Containers Service deploy). Decision: drop the duplicate workflow, reuse `publish-{api,ui}-image` of `ci.yml` with image name override `sentropic-{api,ui}` and dual tag push (sha1 content-hash + branch alias `feat-deploy-poc-k8s` during PR, then `main` post-merge). New neutral `deploy-k8s` job in `ci.yml` runs `kubectl rollout restart` on the Kubernetes tenant after publish. Tag strategy: manifests reference the floating branch/main alias with `imagePullPolicy: Always` and no imperative `kubectl set image` or envsubst. Kubeconfig sourced from new GH secret `KUBECONFIG_B64`. AI flaky `tests/03-chat.spec.ts` cleared by rerun on 2026-05-19 (CI run 26035260832 second attempt green; allowlist per `rules/testing.md:42`). Follow-up on 2026-05-20: user selected neutral deployment target naming `deploy-k8s` + `KUBECONFIG_B64`; branch name and alias tag remain `feat-deploy-poc-k8s`.
- **BR37-FL10** (severity: `fixed`, status: `closed`): SCW Container Registry namespace literal was corrected on 2026-05-20. Root `.env` has `REGISTRY=rg.fr-par.scw.cloud/nc-reg`, matching the CI publish path; manifests now pull `rg.fr-par.scw.cloud/nc-reg/sentropic-{api,ui}:feat-deploy-poc-k8s`. The previous `rg.fr-par.scw.cloud/sentropic/...` literal caused `insufficient_scope` image pulls. Rollback: replace the literal in `30-api.yaml`/`40-ui.yaml`.
- **BR37-FL11** (severity: `fixed`, status: `closed`): Branch push CI run 26158420180 on 2026-05-20 confirmed the temporary branch trigger and the neutral `deploy-k8s` graph node. First attempt hit the known AI flaky `tests/03-chat.spec.ts` signature (`Raisonnement|Reasoning` runtime header missing after model output); rerun of `test-e2e (group-c, 03)` passed on the same SHA. The next blocker was `publish-ui-image`: artifacts were built under the Makefile defaults `top-ai-ideas-{api,ui}` while BR37 publishes `sentropic-{api,ui}`. Fixed by retagging the loaded artifact images to the Sentropic publish names inside the existing `publish-{api,ui}-image` jobs before `make publish-*`.
- **BR37-FL12** (severity: `fixed`, status: `closed`): Branch push CI run 26201388648 published the api/ui images successfully, then `deploy-k8s` initially failed because GitHub Actions secret `KUBECONFIG_B64` was missing or empty. Fixed on 2026-05-20 via `make gh-k8s-secret KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` and `make gh-k8s-secret-check ENV=test-feat-deploy-poc-k8s`; rerun reached Kubernetes rollout. No secret value was printed.
- **BR37-FL13** (severity: `fixed`, status: `closed`): Live k8s rollout debugging on 2026-05-20 found three POC-only deployment blockers after `KUBECONFIG_B64` was fixed: missing `sentropic-registry` pull secret, wrong registry namespace literal (`sentropic` instead of `nc-reg`), and tenant `default-deny-ingress` blocking api -> postgres. Fixed by adding `scw-registry-secret`, `scw-debug`, `scw-logs`, `scw-smoke`, `deploy/scw/15-networkpolicy.yaml`, `strategy: Recreate` for api/ui under tight quota, and an api `startupProbe` for startup migrations. Evidence: `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` rolled out api/ui; `make scw-status ...` showed api/ui/maildev/postgres all `1/1`; `make scw-smoke ...` returned OK for api `/api/v1/health`, ui `/`, and maildev `/`.

## AI Flaky tests
- This branch does not change AI runtime behavior.
- `tests/03-chat.spec.ts` has a documented AI flaky signature in BR37-FL9/BR37-FL11; rerun on 2026-05-20 passed on the same SHA after the initial `Raisonnement|Reasoning` runtime header miss.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one infrastructure POC with tightly coupled manifests, workflow, Make targets, and UAT docs; independent sub-branches would add coordination without reducing risk.

## UAT Management (in orchestration context)
- Mono-branch. UAT happens against the live `poc-k8s` cluster after PR image publication.
- Root dev/UAT remains reserved for user dev on `ENV=dev`.
- Docker-compose dev/CI remains unchanged.
- Operator-side namespace/quota/baseline prerequisites live in `~/src/poc-k8s`; workload and registry pull-secret helpers live in this repo.
- Merge gate:
  - [ ] PR CI is green after `BRANCH.md` repair.
  - [x] Live Kubernetes UAT passed, or explicit user waiver recorded.
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
  - [x] Add `deploy/scw/15-networkpolicy.yaml` workload ingress allowances for the tenant default-deny baseline.
  - [x] Add `deploy/scw/20-postgres.yaml` Postgres 17 StatefulSet, headless Service, 1Gi `scw-bssd` PVC, and ConfigMap.
  - [x] Add `deploy/scw/30-api.yaml` api Deployment, ClusterIP Service on port 8787, non-secret ConfigMap, and `sentropic-api` Secret references.
  - [x] Add `deploy/scw/40-ui.yaml` ui Deployment and ClusterIP Service on port 5173.
  - [x] Add `deploy/scw/50-maildev.yaml` dev SMTP capture Deployment and ClusterIP Service.
  - [x] Add optional `deploy/scw/60-ingress.yaml` with placeholder hosts and `SCW_INGRESS=1`.
  - [x] Document that namespace, ResourceQuota, LimitRange, and NetworkPolicy are owned by `poc-k8s/tenants/sentropic`, not this repo.

- [x] **Lot 2 — Images, Make targets, docs**
  - [x] Add `.github/workflows/build-and-push-images.yml` for api/ui production image builds to GHCR on tags, `main`, `feat/deploy-poc-k8s`, and manual dispatch.
  - [x] Add append-only `Makefile` targets: `scw-deploy`, `scw-undeploy`, `scw-bundle-secret`, `scw-registry-secret`, `scw-status`, `scw-debug`, `scw-logs`, `scw-smoke`.
  - [x] Add `deploy/scw/README.md` with operator prerequisites, secret bundle, deploy, smoke, pause/resume, and cleanup notes.
  - [x] Add `docs/uat/2026-05-16-deploy-poc-k8s.md` with live UAT checklist and known limitations.
  - [x] Confirm PR #160 CI/checks were reported green by recovered GitHub context, including image jobs.
  - [x] Align api/ui manifest tags with the branch image workflow tag `feat-deploy-poc-k8s`.
  - [x] Rename BR-37 POC GHCR artifacts from `top-ai-ideas-api/ui` to `sentropic-api/ui`; leave broader transition items to BR-14e/BR-14d.
  - [x] Preserve the full branch slug in GHCR image tags so `feat/deploy-poc-k8s` publishes `feat-deploy-poc-k8s`.

- [ ] **Lot 2.5 — CI/CD redressement (SCW Registry + Kubernetes rollout)**
  - [x] Delete `.github/workflows/build-and-push-images.yml` (BR37-EX2 revoked).
  - [x] Add a temporary branch push trigger for `feat/deploy-poc-k8s` so publish + deploy can run before merge.
  - [x] Amend `ci.yml` `publish-api-image` job with env override `API_IMAGE_NAME=sentropic-api` and a step that pushes a dual alias tag (`feat-deploy-poc-k8s` on branch, `main` on main).
  - [x] Amend `ci.yml` `publish-ui-image` job with the same pattern and `UI_IMAGE_NAME=sentropic-ui`.
  - [x] Retag loaded Makefile-default image artifacts (`top-ai-ideas-api/ui`) to the BR37 publish targets (`sentropic-api/ui`) before SCW Registry push.
  - [x] Add new neutral job `deploy-k8s` in `ci.yml` with `needs: [publish-api-image, publish-ui-image]`, branch-conditional, that loads kubeconfig from `KUBECONFIG_B64` GH secret, runs `kubectl -n sentropic rollout restart deployment/api deployment/ui` and `kubectl rollout status` with timeout. (BR37-EX4)
  - [x] Add Make-only GitHub Actions kubeconfig helper targets: `gh-k8s-secret`, `gh-k8s-secret-check`, `gh-k8s-rerun-deploy`, and `gh-k8s-watch`. (BR37-EX5)
  - [x] Patch `deploy/scw/30-api.yaml` to image `rg.fr-par.scw.cloud/nc-reg/sentropic-api:feat-deploy-poc-k8s` with `imagePullPolicy: Always`.
  - [x] Patch `deploy/scw/40-ui.yaml` to image `rg.fr-par.scw.cloud/nc-reg/sentropic-ui:feat-deploy-poc-k8s` with `imagePullPolicy: Always`.
  - [x] Patch `deploy/scw/10-rbac.yaml` to add `imagePullSecrets: [{ name: sentropic-registry }]` on ServiceAccount `sentropic-app`.
  - [x] Update `deploy/scw/README.md` to replace GHCR references by SCW Registry and document `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s`.
  - [x] Create/update SCW Registry pull secret with `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s`.
  - [x] Run `make gh-k8s-secret KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`, then `make gh-k8s-secret-check ENV=test-feat-deploy-poc-k8s`, to create GitHub Actions secret `KUBECONFIG_B64`.
  - [x] Rerun deploy with `make gh-k8s-rerun-deploy GH_DEPLOY_RUN_ID=26201388648 ENV=test-feat-deploy-poc-k8s`; GitHub watch hit API rate limit, local k8s UAT completed after follow-up fixes in this commit.
  - [ ] At PR merge to main: edit manifests `:feat-deploy-poc-k8s` to `:main` and remove the branch alias from ci.yml publish steps.

- [ ] **Lot 3 — Live poc-k8s UAT**
  - [x] Confirm next deploy target is the Sentropic app workload from this BR-37 worktree.
  - [x] Verify obsolete session `session-sess-apr95chl` is already absent: pod, PVC, and auth Secret all return `NotFound`.
  - [x] Confirm `poc-k8s` operator side is applied: namespace `sentropic`, ResourceQuota, LimitRange, NetworkPolicy baseline.
  - [x] Bundle secrets from root `.env`: `sentropic-postgres` and `sentropic-api`.
  - [x] Verify Kubernetes pull-secret `sentropic-registry` exists by creating it via `make scw-registry-secret KUBECONFIG=$HOME/.kube/poc.yaml SCW_ENV_FILE=$HOME/src/sentropic/.env ENV=test-feat-deploy-poc-k8s`.
  - [x] Deploy workload: `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
  - [x] Snapshot workload: `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s`.
  - [x] Port-forward api via `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` and verify `/api/v1/health`.
  - [x] Port-forward ui via `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` and verify `/`.
  - [x] Port-forward maildev via `make scw-smoke KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s` and verify the UI.
  - [x] Record quota usage and whether it remains within tenant budget: ResourceQuota reported pods `4/8`, requests.cpu `260m/300m`, requests.memory `512Mi/768Mi`, limits.cpu `1200m/1500m`, limits.memory `1280Mi/1500Mi`.
  - [x] Record evidence in `docs/uat/2026-05-16-deploy-poc-k8s.md` or this file.

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
