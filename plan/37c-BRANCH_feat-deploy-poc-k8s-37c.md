# Feature: BR-37c poc-k8s hardening (Postgres backup, public Ingress + cert-manager, deploy validation)

## Objective
Continuation of BR-37b (email egress + Sealed Secrets, merged PR #176). Close the remaining poc-k8s hardening items on the shared Scaleway Kapsule cluster: a Postgres backup CronJob to SCW Object Storage, public HTTPS access at `sentropic.sent-tech.ca` via Ingress + cert-manager (Cloudflare DNS-01 ACME), and an end-to-end publish → deploy-k8s → rollout → smoke validation. The `poc-k8s` cluster name is operational scaffolding only; this stack is treated as production (no `poc` segment in user-facing/persistent resource names).

## Scope / Guardrails
- Scope limited to `deploy/scw/**` tenant manifests, append-only `Makefile` operator targets, the CI `deploy-k8s` trigger surface, UAT evidence docs, and `plan/37c-BRANCH_*.md` + `plan/done/*` archival.
- No app code changes (`api/`, `ui/`, `packages/`). No DB schema migration. No docker-compose change.
- Make-only workflow; no direct Docker/kubectl outside make targets. `ENV=<env>` always last.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`); branch work in worktree `tmp/feat-deploy-poc-k8s-37c`.
- Local gates on `ENV=test-feat-deploy-poc-k8s-37c`. Live k8s UAT uses `KUBECONFIG=$HOME/.kube/poc.yaml`.
- Reuse the Sealed Secrets pattern from BR-37b (controller already live in ns `sealed-secrets`): any new secret is sealed via `make scw-seal-secret`, never committed in plaintext.
- All new text in English.
- Branch identity: BR-37c, branch `feat/deploy-poc-k8s-37c`, worktree `tmp/feat-deploy-poc-k8s-37c`; base = origin/main `b366321d` (BR-37b merge).
- Local slot 2 ports if needed: API `9187`, UI `5387`, Maildev `1287`.
- `BRANCH.md` must remain a symlink to `plan/37c-BRANCH_feat-deploy-poc-k8s-37c.md`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md` (symlink only)
  - `plan/37c-BRANCH_feat-deploy-poc-k8s-37c.md`
  - `plan/done/37-BRANCH_feat-deploy-poc-k8s.md`, `plan/done/37b-BRANCH_feat-deploy-poc-k8s-37b.md` (archival)
  - `deploy/scw/**` (new: pgbackup CronJob, cert-manager, ClusterIssuer, ingress; sealed backup secret)
  - `docs/uat/2026-05-25-deploy-poc-k8s-37c.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`, `ui/**`, `packages/**`, `e2e/**`, `rules/**`, `spec/**`, `.cursor/rules/**`, `TRANSITION.md`, `tools/**`, `docker-compose*.yml`
  - `plan/NN-BRANCH_*.md` except `plan/37c-BRANCH_feat-deploy-poc-k8s-37c.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (`BR37c-EX1`, append-only: `scw-pgbackup-now`, `scw-pgbackup-restore`, `scw-dns-smoke`, `scw-cert-manager-install`; never modify existing `scw-*` targets)
  - `.github/workflows/ci.yml` (`BR37c-EX2`, only if the `deploy-k8s` trigger/apply set must include the new manifests; strict scope: no logic change to build/publish jobs)
  - `PLAN.md` (`BR37c-EX3`, roadmap status update only)

## Feedback Loop
- **BR37c-EX1** (status: `pending`): append-only Makefile operator targets (pgbackup now/restore, dns smoke, cert-manager install). Rollback: remove appended targets.
- **BR37c-EX2** (status: `pending`): `ci.yml` deploy-k8s apply-set extension if needed so a fresh cluster applies cert-manager/ingress/backup manifests. Rollback: revert ci.yml hunk.
- **BR37c-EX3** (status: `pending`): PLAN.md status update (BR-37c progress/done). Rollback: revert hunk.
- **BR37c-FL1** (severity: `attention`, status: `open`): Public hostname confirmed as `sentropic.sent-tech.ca` (Cloudflare zone `sent-tech.ca`). DNS record creation + Cloudflare API token (scope `Zone/DNS/Edit` on `sent-tech.ca`) are operator-side, irreversible/shared-infra → require explicit user go-ahead before execution.
- **BR37c-FL2** (severity: `attention`, status: `open`): Postgres backup bucket `sentropic-pgbackup` provisioned once via SCW CLI in project `$SCW_DEFAULT_PROJECT_ID`; S3 creds mutualised with `DOC_STORAGE_*_PROD` (segmentation at bucket boundary). Backup creds go into a sealed `sentropic-pgbackup` SealedSecret.

## AI Flaky tests
- This branch changes no AI runtime behavior. The `test-api-unit-integration (ai, initiative-generation-async,executive-summary-sync)` shard is a known flaky-accepted signature (documented in BR-37b, archived `plan/done/37b-*`); rerun on the same commit if it blocks publish/deploy.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: tightly-coupled tenant manifests + operator runbook; one final test/UAT cycle.

## UAT Management (in orchestration context)
- Mono-branch. UAT against the live `poc-k8s` cluster after manifest apply.
- Merge gate: PR CI green; live UAT per lot (pg backup round-trip, TLS reachability of the public host) or explicit user waiver; rollback path documented per resource.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & archival**
  - [x] Create worktree `tmp/feat-deploy-poc-k8s-37c` from origin/main `b366321d`.
  - [x] Archive `plan/done/37-BRANCH_feat-deploy-poc-k8s.md` (from `f0352c5e:BRANCH.md`) + move BR-37b plan to `plan/done/`.
  - [ ] Author this plan + `BRANCH.md` symlink; open draft PR; verify Sealed Secrets controller still live (`kubectl -n sealed-secrets get deploy`).

- [x] **Lot 1 — Postgres backup CronJob to SCW Object Storage (BR37c-FL2)** _(done 2026-05-25: round-trip green — dump 12.1 KiB, restore OK; needed allow-pgbackup-to-postgres NetworkPolicy + non-masked dump)_
  - [x] Bucket `sentropic-pgbackup` created via `aws s3 mb` (DOC_STORAGE S3 creds, endpoint https://s3.fr-par.scw.cloud).
  - [x] `PG_BACKUP_BUCKET` added to root `.env`; sealed `deploy/scw/07-sealed-sentropic-pgbackup.yaml`.
  - [x] `deploy/scw/70-pgbackup-cronjob.yaml`: nightly `15 2 * * *`, initContainer postgres:17-alpine (pg_dump→file→gzip, `test -s`), container amazon/aws-cli:2.34.53 upload to `s3://$S3_BUCKET/pg/<ts>.sql.gz`; bucket from SealedSecret. Added `allow-pgbackup-to-postgres` NetworkPolicy in 15-networkpolicy.yaml.
  - [x] `make scw-pgbackup-now` + `make scw-pgbackup-restore` (restore to scratch `restore_check` DB, label component=pgbackup) appended (BR37c-EX1).
  - [x] Lot gate PASSED: bucket listed; `scw-pgbackup-now` wrote pg/20260525T155806Z.sql.gz (12.1 KiB); `scw-pgbackup-restore` restored to scratch DB + `select count(*) organizations` ran OK.

- [ ] **Lot 2 — Public Ingress + cert-manager via Cloudflare DNS-01 (BR37c-FL1)** _(STOP for user go-ahead before DNS/token ops)_
  - [ ] Operator (gated): create Cloudflare API token (`Zone/DNS/Edit` on `sent-tech.ca`), add `CLOUDFLARE_API_TOKEN` to root `.env`, seal → `deploy/scw/04-sealed-cloudflare-api-token.yaml` (ns `cert-manager`).
  - [ ] Add `deploy/scw/02-cert-manager.yaml` (pinned version, ns `cert-manager`) + `make scw-cert-manager-install`.
  - [ ] Add `deploy/scw/03-clusterissuer-letsencrypt.yaml` (staging + prod, DNS-01 cloudflare solver).
  - [ ] Update `deploy/scw/60-ingress.yaml` for host `sentropic.sent-tech.ca`, TLS via ClusterIssuer (staging first → prod).
  - [ ] Operator (gated): create the Cloudflare DNS record → Ingress public IP.
  - [ ] Add `make scw-dns-smoke` (resolve host, hit `https://sentropic.sent-tech.ca/api/v1/health` + `/`, print TLS issuer) (BR37c-EX1).
  - [ ] Lot gate: cert issued (staging→prod); `make scw-dns-smoke` 200 + trusted cert.

- [ ] **Lot 3 — End-to-end deploy validation**
  - [ ] Trigger main-path publish → deploy-k8s (extend `deploy-k8s` apply-set for the new manifests if needed, BR37c-EX2).
  - [ ] Re-run smoke matrix: `scw-smoke`, `scw-email-smoke`, `scw-dns-smoke`, `scw-pgbackup-now`→`scw-pgbackup-restore`.
  - [ ] Record evidence in `docs/uat/2026-05-25-deploy-poc-k8s-37c.md`.
  - [ ] Lot gate: `scw-deploy` idempotent (re-apply no churn); all smokes green.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `deploy/scw/README.md` runbook (pg backup operate/restore, ingress/cert-manager).
  - [ ] PLAN.md status → BR-37c done (BR37c-EX3).

- [ ] **Lot N — Final validation**
  - [ ] Confirm `make typecheck/lint` unaffected; CI green on PR.
  - [ ] PR body = this plan; UAT + CI green → remove `BRANCH.md` symlink, merge; move `plan/37c-*` to `plan/done/`.

## Deferred to BR-14d / future BR
- [ ] Final production hostname + migration off the `poc-k8s` cluster name.
- [ ] Vault / External Secrets Operator; CNPG operator / PITR for postgres.
- [ ] Wildcard cert for `*.sent-tech.ca` if multiple subdomains appear.
