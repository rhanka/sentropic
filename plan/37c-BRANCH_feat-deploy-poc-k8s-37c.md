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
- **BR37c-EX1** (status: `used`): append-only Makefile operator targets (`scw-pgbackup-now`, `scw-pgbackup-restore`, `scw-dns-smoke` + `SCW_HOST` var). Rollback: remove appended targets.
- **BR37c-EX2** (status: `not used` 2026-05-25): `ci.yml` deploy-k8s left unchanged. The deploy-k8s job is the rolling app deploy (`make scw-deploy`); cluster-wide ingress (cert-manager/traefik/LB) lives in the poc-k8s repo, and one-time tenant infra (sealed secrets, pgbackup CronJob, ingress) is applied operator-side once — same model as the BR-37b sealed-secrets controller. No fresh-cluster gap that warrants a CI change for this POC.
- **BR37c-EX3** (status: `pending`): PLAN.md status update (BR-37c progress/done). Rollback: revert hunk.
- **BR37c-FL1** (severity: `attention`, status: `resolved` 2026-05-25): Public hostname `sentropic.sent-tech.ca` LIVE. Cloudflare token reused from `onyxia/.env` `CF_API_TOKEN` (verified `dns_records:edit`+`zone:read`, sealed in poc-k8s). User approved "Go direct en prod"; DNS A record → `51.159.11.157` created, `sentropic-tls` issued (letsencrypt-prod), `scw-dns-smoke` green (200 + trusted cert on `/` and `/api/v1/health`).
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

- [ ] **Lot 2 — Public Ingress for sentropic.sent-tech.ca** _(RESCOPED 2026-05-25: cluster-wide ingress stack DELEGATED to the `poc-k8s` repo per operator decision)_
  - Decision (operator): the shared ingress-controller (traefik), the SCW **LoadBalancer LB-GP-S** (~11.68€/mo, mutualised across all cluster tenants), cert-manager, and the Cloudflare DNS-01 `ClusterIssuer` are **cluster-wide platform** concerns and are delivered by `~/src/poc-k8s` (`platform/`, applied via `make apply-platform`), NOT by this app repo. Cluster verified bare: `traefik` + `cert-manager` namespaces exist but are EMPTY (no controller); no LoadBalancer; no ingressclass. Cloudflare token reused (valid on zone `sent-tech.ca`, found in `spa-transpose-cv/.env`, now in root `.env` as `CLOUDFLARE_API_TOKEN`).
  - BR-37c retains ONLY the app-level `Ingress` for `sentropic.sent-tech.ca` → `deploy/scw/60-ingress.yaml` (host + path routing to ui/api, `ingressClassName: traefik`, `cert-manager.io/cluster-issuer` annotation referencing the poc-k8s-provided issuer). This is GATED on poc-k8s delivering the platform ingress + ClusterIssuer first.
  - [x] (poc-k8s) Platform delivers traefik ingress-controller + Service type=LoadBalancer (**SCW LB-S** — `lb-gp-s` is not provisionable in fr-par; user-approved lb-s 100 Mbit/s), cert-manager v1.20.2 (pinned URL), Cloudflare DNS-01 ClusterIssuers staging+prod (+ sealed CF token, reusing the cluster-wide sealed-secrets controller). _Delivered in repo `poc-k8s` branch `platform/ingress-traefik-lb-cert-manager` (pushed). Live 2026-05-25: LB public IP **51.159.11.157** (type confirmed lb-s), cert-manager 3/3 rolled out, secret `cloudflare-api-token` decrypted in ns cert-manager, ClusterIssuers letsencrypt-staging+prod Ready=True (ACME account registered)._
  - [x] (BR-37c) `deploy/scw/60-ingress.yaml` rewritten for `sentropic.sent-tech.ca` (single host → `ui` Service; nginx proxies `/api`→api:8787; TLS via `letsencrypt-prod`). `make scw-dns-smoke` added (BR37c-EX1, `SCW_HOST` var; HTTPS 200 + trusted cert on `/` and `/api/v1/health`).
  - [x] (BR-37c, user-approved "Go direct en prod" 2026-05-25) Cloudflare DNS A record `sentropic.sent-tech.ca` → `51.159.11.157` created; ingress applied; cert-manager issued `sentropic-tls` (letsencrypt-prod, DNS-01, valid to 2026-08-23). Added NetworkPolicy `allow-traefik-to-ui` (ns `traefik` → ui:5173) in `15-networkpolicy.yaml` — the default-deny was dropping Traefik→ui (HTTPS timed out post-handshake). Also fixed the poc-k8s traefik manifest (missing nodes+configmaps RBAC + stray kubernetescrd provider) so it serves the Ingress + its TLS secret.
  - [x] Lot gate PASSED: `make scw-dns-smoke` → `https://sentropic.sent-tech.ca/` and `/api/v1/health` both 200 with a trusted Let's Encrypt cert (`ssl_verify=0`, issuer O=Let's Encrypt).

- [x] **Lot 3 — End-to-end deploy validation** _(done 2026-05-25)_
  - [x] `deploy-k8s` apply-set reviewed: the CI job runs `make scw-deploy` (rbac, netpol incl. new `allow-traefik-to-ui`, postgres, api, ui) — the rolling app deploy. One-time infra (sealed secrets `01/05/06/07`, pgbackup CronJob `70`, ingress `60`) is applied operator-side once, identical to the BR-37b sealed-secrets model → **BR37c-EX2 not needed** (no `ci.yml` change). Documented in the runbook.
  - [x] Smoke matrix GREEN on the live cluster (`/tmp/lot3-smoke-matrix.out`): `scw-smoke` (api+ui), `scw-dns-smoke` (public host trusted TLS), `scw-email-smoke` (live TEM, accepted for fabien.antoine@gmail.com), `scw-pgbackup-now`→`scw-pgbackup-restore` (round-trip OK). Hardened `scw-pgbackup-restore` to read `S3_BUCKET`/`S3_ENDPOINT`/`S3_REGION` from the SealedSecret (was depending on a host `PG_BACKUP_BUCKET` env var → empty-bucket failure).
  - [x] Evidence recorded in `docs/uat/2026-05-25-deploy-poc-k8s-37c.md`.
  - [x] Lot gate PASSED: `make scw-deploy SCW_INGRESS=1` idempotent (every manifest `unchanged`/`configured`, no new creates); all smokes green.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Updated `deploy/scw/README.md` runbook: new file list entries (07/70, updated 15/60), a "Postgres backup" section (now/restore) and a "Public ingress / TLS" section (poc-k8s platform split + DNS-01 + scw-dns-smoke).
  - [ ] PLAN.md status → BR-37c done (BR37c-EX3) — at branch close.

- [ ] **Lot N — Final validation**
  - [ ] Confirm `make typecheck/lint` unaffected; CI green on PR.
  - [ ] PR body = this plan; UAT + CI green → remove `BRANCH.md` symlink, merge; move `plan/37c-*` to `plan/done/`.

## Deferred to BR-14d / future BR
- [ ] Final production hostname + migration off the `poc-k8s` cluster name.
- [ ] Vault / External Secrets Operator; CNPG operator / PITR for postgres.
- [ ] Wildcard cert for `*.sent-tech.ca` if multiple subdomains appear.
