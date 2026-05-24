# Feature: BR-37b Finalize poc-k8s deployment (SMTP egress, sealed secrets, postgres backup, public ingress)

## Objective
Take the live Sentropic deployment on the shared `poc-k8s` Scaleway Kapsule cluster to a maintainable steady state by closing the four remaining items: real outbound SMTP delivery from the k8s pod (BR37-FL16), Bitnami Sealed Secrets for git-as-source-of-truth secret management, Postgres backup CronJob to SCW Object Storage (bucket `sentropic-pgbackup`, configured via env var, credentials mutualised with the existing `DOC_STORAGE_*` SCW Object Storage IAM), and public access at `sentropic.sent-tech.ca` via Ingress + cert-manager with Cloudflare DNS-01 ACME. Validate the end-to-end publish → deploy-k8s → rollout → smoke chain on the new main HEAD. The `poc-k8s` cluster name is operational scaffolding only: this stack is treated as production from the BR-37b plan and naming standpoint, no `poc` segment in user-facing or persistent resource names.

## Scope / Guardrails
- Scope limited to tenant manifests under `deploy/scw/**`, append-only `Makefile` targets for new operator helpers, CI `deploy-k8s` job trigger surface, UAT evidence docs, and `plan/37b-BRANCH_*.md` itself.
- No app code changes (`api/`, `ui/`, `packages/`).
- No database schema migration.
- No docker-compose change.
- No dev/CI migration to Kubernetes; root dev remains docker-compose.
- BR-37b is a follow-up of BR-37 (merged via PR #160). BR-14d still owns final production naming/transition ops.
- Make-only workflow for this repo; no direct Docker or kubectl commands outside make targets.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-deploy-poc-k8s-37b`.
- Automated local gates, if needed, run on `ENV=test-feat-deploy-poc-k8s-37b`, never on root `dev`.
- UAT qualification runs against the live `poc-k8s` tenant after image publication and records cluster evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch identity: BR-37b, branch `feat/deploy-poc-k8s-37b`, worktree `tmp/feat-deploy-poc-k8s-37b`; base commit `b48065d1` (origin/main at branch creation).
- Local slot 1 ports, only for local gates if needed: API `9186`, UI `5386`, Maildev `1286`. Slot 0 (`9185`/`5385`/`1285`) reserved for legacy `tmp/feat-deploy-poc-k8s` worktree.
- Live k8s UAT uses `KUBECONFIG=$HOME/.kube/poc.yaml` and temporary port-forwards for api/ui smoke checks.
- `BRANCH.md` must remain a symlink to `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` in `tmp/feat-deploy-poc-k8s-37b`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md` (symlink only)
  - `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md`
  - `deploy/scw/**` (tenant manifests, including new files for sealed-secrets resources, postgres-backup CronJob, ingress, cert-manager ClusterIssuer)
  - `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`
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
  - `plan/NN-BRANCH_*.md` except `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`BR37b-EX1`, append-only targets for sealed-secrets, postgres backup, smtp diagnostics, dns/ingress smoke; never modify existing BR-37 `scw-*` block behavior)
  - `.github/workflows/ci.yml` (`BR37b-EX2`, if a deploy-k8s trigger touch is needed to validate the end-to-end chain on a non-deploy-touching merge — strict scope: trigger conditions only, no logic change)
  - `PLAN.md` (`BR37b-EX3`, roadmap registration of BR-37b only)
- **Exception process**:
  - Declare exception ID `BR37b-EXn` in `## Feedback Loop` before touching any conditional path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR37b-EX1** (status: `pending`): Conditional `Makefile` change for append-only operator targets: `scw-sealed-secrets-install`, `scw-seal-secret`, `scw-pgbackup-now`, `scw-pgbackup-restore`, `scw-smtp-diag`, `scw-dns-smoke`. Reason: encode new operator paths as Make-only entrypoints consistent with BR-37 `scw-*` block. Impact: append-only targets; no existing target behavior changed. Rollback: remove appended targets.
- **BR37b-EX2** (status: `pending`): Conditional `.github/workflows/ci.yml` change, scope strictly limited to extending the `deploy-k8s` job trigger filter so that ingress/sealed-secret/backup manifest changes do trigger a fresh apply on merge, plus optional ingress/cert smoke step. No change to publish or build jobs. Rollback: revert ci.yml diff.
- **BR37b-EX3** (status: `pending`): Add BR-37b row in `PLAN.md` branch catalog (`§3`) and dependency graph (`§4`). Reason: roadmap hygiene. Impact: docs-only. Rollback: revert PLAN.md hunks.
- **BR37b-FL1** (severity: `attention`, status: `open`): Carries forward BR37-FL16. Live outbound email from the k8s POC pod is blocked at SMTP egress. As of 2026-05-22, `scw-email-smoke` returned HTTP 500; pod-side netcheck showed `smtp.tem.scaleway.com:465` and `:587` time out, IPv4 `51.159.84.239:465` times out, while `api.scaleway.com:443` reachable. Working hypothesis: Scaleway Kapsule egress posture blocks outbound SMTP, or Scaleway TEM IP ranges are unreachable from the POC node pool subnet. Investigate before fixing.
- **BR37b-FL2** (severity: `attention`, status: `open`): Sealed Secrets is the standard k8s pattern selected by user (no Vault, no External Secrets Operator with remote backend). Controller deployed as a Helm release or raw manifests in a dedicated namespace; sealing key sealed-into the cluster. Disaster recovery: backup the controller's sealing key (master) out-of-band; document procedure.
- **BR37b-FL3** (severity: `attention`, status: `open`): Postgres backup uses a k8s native `CronJob` with `pg_dump | aws s3 cp` to SCW Object Storage (S3-compatible). No CNPG operator. Bucket name `sentropic-pgbackup` is **not hardcoded** — manifests reference env var `PG_BACKUP_BUCKET`. Bucket is operator-provisioned in the same SCW project as the existing app object storage, via SCW CLI: `scw object bucket create name=sentropic-pgbackup region=$DOC_STORAGE_REGION_PROD project-id=$SCW_DEFAULT_PROJECT_ID`. IAM credentials are **mutualised** with `DOC_STORAGE_ACCESS_KEY_PROD` / `DOC_STORAGE_SECRET_KEY_PROD` already present in root `.env`: segmentation enforced at the bucket boundary, not at the credential boundary (per user direction "pas à l'excès"). New root `.env` entries: `PG_BACKUP_BUCKET=sentropic-pgbackup`, optional `PG_BACKUP_REGION` / `PG_BACKUP_ENDPOINT` (default to the `DOC_STORAGE_*_PROD` siblings if unset). No new secret value is committed; the SealedSecret references the same credentials as the app.
- **BR37b-FL4** (severity: `attention`, status: `open`): Public DNS + Ingress + cert-manager. Confirmed POC public hostname: `sentropic.sent-tech.ca` (under the existing `sent-tech.ca` zone hosted on Cloudflare). cert-manager uses the **Cloudflare DNS-01 ACME challenge** (not HTTP-01), which allows wildcard certs for `*.sent-tech.ca` and works without exposing the Ingress on port 80 during the challenge. Cloudflare API token (scope: `Zone / DNS / Edit` on `sent-tech.ca`) is provisioned operator-side and stored in root `.env` as `CLOUDFLARE_API_TOKEN`, then sealed into the cluster via Sealed Secrets. ClusterIssuer staging is used first to validate the loop, then production after one successful issuance.

## AI Flaky tests
- This branch does not change AI runtime behavior.
- Carries forward the BR37 acceptance for `tests/03-chat.spec.ts` if rerun signature reappears on the branch PR; document in `## Feedback Loop` and request user sign-off only if observed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: four small infrastructure lots tightly coupled to the same tenant manifests and operator runbook. Multi-branch would force redundant `scw-deploy` cycles and risk drift between sub-branches without reducing risk.

## UAT Management (in orchestration context)
- Mono-branch. UAT happens against the live `poc-k8s` cluster after PR image republish (or after each lot for k8s-only changes that do not require a new image).
- Root dev/UAT remains reserved for user dev on `ENV=dev`.
- Docker-compose dev/CI remains unchanged.
- Merge gate:
  - [ ] PR CI is green.
  - [ ] Live Kubernetes UAT passes for each impacted lot (SMTP egress, sealed secrets round-trip, pg backup round-trip, public ingress TLS reachability), or explicit user waiver recorded per lot.
  - [ ] Rollback path is documented per new resource (sealed-secrets, pgbackup, ingress, cert-manager).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & investigation**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`, `rules/testing.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm branch `feat/deploy-poc-k8s-37b`, worktree `tmp/feat-deploy-poc-k8s-37b`, base commit `b48065d1`.
  - [ ] Confirm `BRANCH.md` is a symlink to `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` in worktree root.
  - [ ] Confirm operator side prerequisites unchanged since BR-37: namespace `sentropic`, ResourceQuota, LimitRange, baseline NetworkPolicies in `~/src/poc-k8s/tenants/sentropic`.
  - [ ] Snapshot live state: `make scw-status KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Record evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`.
  - [ ] Capture current SMTP egress signature: `make scw-api-netcheck SCW_NETCHECK_HOST=smtp.tem.scaleway.com SCW_NETCHECK_PORT=465 KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b`. Repeat with port 587 and with `api.scaleway.com:443` as control.
  - [ ] Confirm scope and guardrails. Declare `BR37b-EX1`, `BR37b-EX2`, `BR37b-EX3` only when first impacted file is touched.

- [ ] **Lot 1 — SMTP egress unblocking (BR37b-FL1)**
  - [ ] Investigate cluster egress posture: list active `NetworkPolicy` egress rules in `sentropic` namespace and any platform-level egress firewall on the Kapsule node pool subnet.
  - [ ] Test direct IPv4 endpoints for Scaleway TEM: `51.159.84.239:465`, `51.159.84.239:587` (control: `api.scaleway.com:443`).
  - [ ] Decide between the following remediation paths based on investigation evidence:
    - Path A (NetworkPolicy egress allow): add `deploy/scw/16-egress-netpol.yaml` with egress rules from `app=api` to TEM SMTP IP CIDRs and DNS, then re-test.
    - Path B (alternative outbound relay): switch the api Secret `MAIL_*` to a Scaleway TEM HTTP API path or a non-SMTP relay if SMTP egress remains blocked at the platform level. No app code change; configure via Secret only.
  - [ ] Add `make scw-smtp-diag` target (append-only) that runs the pod-side netcheck matrix and prints a verdict line. (BR37b-EX1)
  - [ ] Apply the chosen path manifest changes; run `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` after the change.
  - [ ] Re-run `make scw-email-smoke SCW_EMAIL_SMOKE_TO=fabien.antoine@gmail.com KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` and verify HTTP 200 + email delivery confirmation (inbox screenshot in UAT doc).
  - [ ] Mark BR37b-FL1 as `fixed` with evidence (netcheck transcript, smoke return code, mail receipt), or convert to `deferred` with explicit user waiver if path B is rejected.
  - [ ] Lot gate:
    - [ ] No typecheck/lint/unit/E2E test impacted (manifest + Make only).
    - [ ] UAT k8s: `make scw-smoke ENV=test-feat-deploy-poc-k8s-37b`, `make scw-email-smoke ENV=test-feat-deploy-poc-k8s-37b`.

- [ ] **Lot 2 — Sealed Secrets controller + sealing (BR37b-FL2)**
  - [ ] Decide controller install method (manifest-only vs Helm). Preferred: official manifest install from `bitnami-labs/sealed-secrets` release pinned to a specific version, deployed into namespace `sealed-secrets` (or `kube-system` per project convention) without Helm dependency.
  - [ ] Add `deploy/scw/01-sealed-secrets-controller.yaml` (or split files) for: namespace, ServiceAccount, RBAC, Deployment, Service. Pin the image tag explicitly.
  - [ ] Add `make scw-sealed-secrets-install` target (append-only) that applies the controller manifests and waits for controller readiness. (BR37b-EX1)
  - [ ] Generate `kubeseal` binding for existing `sentropic-api` and `sentropic-postgres` Secrets currently created by `make scw-bundle-secret`.
  - [ ] Replace the imperative `scw-bundle-secret` flow with sealed Secrets stored in `deploy/scw/`:
    - [ ] `deploy/scw/05-sealed-sentropic-api.yaml` (SealedSecret resource, encrypted, safe to commit).
    - [ ] `deploy/scw/06-sealed-sentropic-postgres.yaml`.
    - [ ] Add `make scw-seal-secret` helper that seals a given source secret from `SCW_ENV_FILE` into a target SealedSecret yaml. (BR37b-EX1)
  - [ ] Document the disaster-recovery procedure for the controller's sealing key in `deploy/scw/README.md` (operator-side out-of-band backup, file path on operator host, restore steps).
  - [ ] Deprecate or document the legacy `scw-bundle-secret` path (kept for emergency unseal, but no longer the primary mechanism for `sentropic-api` and `sentropic-postgres`).
  - [ ] Lot gate:
    - [ ] `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` applies controller + sealed secrets cleanly.
    - [ ] UAT k8s: kubectl confirms `Secret/sentropic-api` and `Secret/sentropic-postgres` are reconciled from the SealedSecret resources by the controller.
    - [ ] Rolling api/ui pods come up with the reconciled secrets (no env-var regression).

- [ ] **Lot 3 — Postgres backup CronJob to SCW Object Storage (BR37b-FL3)**
  - [ ] Verify existing SCW Object Storage credentials in root `.env`: `DOC_STORAGE_REGION_PROD`, `DOC_STORAGE_ENDPOINT_PROD`, `DOC_STORAGE_ACCESS_KEY_PROD`, `DOC_STORAGE_SECRET_KEY_PROD`. Reuse for pg backup (mutualised IAM, segmented bucket).
  - [ ] Add operator-side bucket provisioning step (run from root `.env` context): `scw object bucket create name=sentropic-pgbackup region="$DOC_STORAGE_REGION_PROD" project-id="$SCW_DEFAULT_PROJECT_ID"`. Document the exact CLI invocation in `deploy/scw/README.md`. The bucket is created **once** by the operator, never by the cluster, never by Make.
  - [ ] Add new env entries in root `.env`: `export PG_BACKUP_BUCKET=sentropic-pgbackup` (mandatory), `export PG_BACKUP_REGION=$DOC_STORAGE_REGION_PROD` (optional override), `export PG_BACKUP_ENDPOINT=$DOC_STORAGE_ENDPOINT_PROD` (optional override). All resolved at sealing time, not hardcoded into manifests.
  - [ ] Add `deploy/scw/06-sealed-sentropic-pgbackup.yaml` SealedSecret containing: `S3_ACCESS_KEY` (=`DOC_STORAGE_ACCESS_KEY_PROD`), `S3_SECRET_KEY` (=`DOC_STORAGE_SECRET_KEY_PROD`), `S3_BUCKET` (=`PG_BACKUP_BUCKET`), `S3_REGION`, `S3_ENDPOINT`. Sealed from root `.env` via `make scw-seal-secret`.
  - [ ] Add `deploy/scw/70-pgbackup-cronjob.yaml`:
    - Schedule: nightly, e.g. `15 02 * * *` UTC.
    - Image: minimal alpine with `postgresql-client` and `aws-cli` (or `mc` for SCW Object Storage), pinned tag.
    - Command: `pg_dump $POSTGRES_*` then `aws s3 cp` to `s3://$S3_BUCKET/<timestamped-key>` with timestamped key prefix.
    - Bucket name read from SealedSecret env var `S3_BUCKET` (not hardcoded in the manifest).
    - Restart policy: `OnFailure`. History limits: `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`.
    - Resource requests/limits within tenant quota; document quota delta.
  - [ ] Add `make scw-pgbackup-now` operator target to manually trigger the CronJob (`kubectl create job --from=cronjob/...`). (BR37b-EX1)
  - [ ] Add `make scw-pgbackup-restore` operator target that pulls a chosen dump from the bucket (using `$PG_BACKUP_BUCKET`), validates checksum, and runs `psql` restore into a scratch DB for verification. Restore into the live DB stays manual to avoid accidental data loss. (BR37b-EX1)
  - [ ] Document bucket lifecycle policy guidance (retention) in `deploy/scw/README.md`; lifecycle policy set via SCW CLI or console, not in this repo.
  - [ ] Lot gate:
    - [ ] Operator-side bucket created via SCW CLI, listed by `scw object bucket list`.
    - [ ] Manual trigger via `make scw-pgbackup-now KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` produces a dump object in `s3://sentropic-pgbackup/`.
    - [ ] UAT k8s: `make scw-pgbackup-restore KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b` restores into scratch DB; record row counts and a `select count(*) from organizations` sanity check.
    - [ ] Tenant ResourceQuota remains within budget after CronJob registration.

- [ ] **Lot 4 — Public DNS + Ingress + cert-manager via Cloudflare DNS-01 (BR37b-FL4)**
  - [ ] Confirmed hostname: `sentropic.sent-tech.ca` (Cloudflare-managed zone `sent-tech.ca`). No DNS record creation in this repo — operator creates it via Cloudflare dashboard or `flarectl`/API once the Ingress controller has a public IP.
  - [ ] Operator-side: create Cloudflare API token scoped to `Zone / DNS / Edit` on `sent-tech.ca` only. Add `export CLOUDFLARE_API_TOKEN=<token>` to root `.env`. Document the token scope and rotation procedure in `deploy/scw/README.md`.
  - [ ] Decide cert-manager install method (manifest-only vs Helm). Preferred: official manifest install pinned to a specific version, deployed into namespace `cert-manager`.
  - [ ] Add `deploy/scw/02-cert-manager.yaml` (or split) for CRDs + controller deployment.
  - [ ] Add `deploy/scw/04-sealed-cloudflare-api-token.yaml` SealedSecret in namespace `cert-manager` containing `api-token`. Sealed from root `.env` `CLOUDFLARE_API_TOKEN` via `make scw-seal-secret`.
  - [ ] Add `deploy/scw/03-clusterissuer-letsencrypt.yaml` with two `ClusterIssuer` resources (`letsencrypt-staging`, `letsencrypt-prod`), both using the ACME DNS-01 solver with the `cloudflare` provider and a `secretKeyRef` to the Cloudflare API token sealed in cert-manager namespace. Choose `letsencrypt-staging` first for the smoke loop, then flip the Ingress annotation to `letsencrypt-prod` after one staging issuance succeeds.
  - [ ] Update `deploy/scw/60-ingress.yaml` to define the real Ingress for api + ui:
    - Host: `sentropic.sent-tech.ca` (and optionally api/ui split-hosts if needed; otherwise single host with path routing).
    - TLS section pointing to the active ClusterIssuer (`letsencrypt-staging` initially, then `letsencrypt-prod`).
    - DNS-01 unlocks wildcard if needed: keep wildcard optional for BR-37b; default is the single host certificate.
    - Ingress class: Nginx (already on the Kapsule by operator-side), or whichever class the `poc-k8s` operator pool exposes.
  - [ ] Add `make scw-dns-smoke` target (append-only) that resolves `sentropic.sent-tech.ca`, hits `https://sentropic.sent-tech.ca/api/v1/health` and `https://sentropic.sent-tech.ca/`, and prints TLS subject + issuer for verification. (BR37b-EX1)
  - [ ] Lot gate:
    - [ ] `make scw-deploy KUBECONFIG=$HOME/.kube/poc.yaml ENV=test-feat-deploy-poc-k8s-37b SCW_INGRESS=1` applies cert-manager controller, sealed Cloudflare token, both ClusterIssuers, and the Ingress.
    - [ ] Ingress controller exposes a public IP/hostname; operator creates the Cloudflare A/AAAA/CNAME record for `sentropic.sent-tech.ca` pointing to it.
    - [ ] cert-manager issues the staging certificate via DNS-01; manual `kubectl describe certificate -n sentropic` confirms `READY=True`.
    - [ ] Flip Ingress annotation to `letsencrypt-prod`; rollout shows fresh prod certificate.
    - [ ] UAT public: `make scw-dns-smoke ENV=test-feat-deploy-poc-k8s-37b` returns 200 for api and ui with a trusted TLS certificate (Let's Encrypt R3 or equivalent).

- [ ] **Lot 5 — End-to-end publish → deploy-k8s → rollout → smoke validation**
  - [ ] Trigger a CI run on `feat/deploy-poc-k8s-37b` push that exercises `publish-api-image`, `publish-ui-image`, and `deploy-k8s`. If `changes` filter prevents `deploy-k8s` from running on a manifest-only diff, extend the filter under `BR37b-EX2`.
  - [ ] Verify `deploy-k8s` applies all four lots' manifests and rolls out api/ui without regression.
  - [ ] Re-run smoke matrix: `scw-smoke`, `scw-email-smoke`, `scw-dns-smoke`, `scw-pgbackup-now` (then `scw-pgbackup-restore` into scratch).
  - [ ] Record evidence in `docs/uat/2026-05-24-deploy-poc-k8s-37b.md`: CI run id, rollout statuses, smoke return codes, mail receipt screenshot, backup object listing, TLS verification output.
  - [ ] Lot gate:
    - [ ] `make scw-deploy ... ENV=test-feat-deploy-poc-k8s-37b` is idempotent: re-apply causes no resource churn.
    - [ ] UAT k8s: all four lot smokes are green.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `deploy/scw/README.md` with the new operator runbook: sealed-secrets workflow (create/rotate/recover), pg backup operate/restore, ingress/cert-manager runbook, smtp diagnostics.
  - [ ] Update or close `docs/uat/2026-05-16-deploy-poc-k8s.md` with a pointer to the BR-37b UAT doc.
  - [ ] Update `PLAN.md` §3 catalog with the BR-37b row, §4 graph with the BR-37b node, and §5 scheduling note (BR-37b is a maintenance follow-up, no wave gating). (BR37b-EX3)
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` consolidation needed; BR-37b does not own a spec.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint not applicable (no app code change). Confirm `make typecheck-api` + `make typecheck-ui` + `make lint-api` + `make lint-ui` remain green on `feat/deploy-poc-k8s-37b` HEAD.
  - [ ] Retest UI: not applicable.
  - [ ] Retest API: not applicable.
  - [ ] Retest e2e: not applicable for k8s tenant changes; rely on CI matrix per `.github/workflows/ci.yml` baseline.
  - [ ] Retest AI flaky tests if signature reappears on PR CI; document and request sign-off only if observed.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted.
  - [ ] Final gate step 1: create/update PR using `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md` symlink (keep `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` as roadmap pointer until BR-37b moves to `plan/done/` post-merge), push, and merge.
  - [ ] Post-merge: move `plan/37b-BRANCH_feat-deploy-poc-k8s-37b.md` to `plan/done/` and update `PLAN.md` status to `done`.

## Deferred to BR-14d / future BR
- [ ] Final production hostname (beyond `sentropic.sent-tech.ca`) and migration off the `poc-k8s` cluster name when a more solid cluster is provisioned. BR-37b runs on `poc-k8s` but treats the workload as production.
- [ ] Vault or External Secrets Operator (if scale beyond the shared Kapsule requires backend-managed secrets, multi-tenant separation, or HSM-backed encryption).
- [ ] Postgres backup automation beyond CronJob: CNPG operator, point-in-time recovery, WAL streaming, multi-region replication.
- [ ] Full dev/CI migration to Kubernetes or k3d (root dev stays docker-compose).
- [ ] Wildcard cert for `*.sent-tech.ca` if multiple subdomains are introduced (DNS-01 already supports it; out of scope as long as the single host suffices).
- [ ] Remaining production Scaleway object, secret, workflow, dashboard, DNS, OAuth, and residual codebase rename finalization (BR-14d scope).
