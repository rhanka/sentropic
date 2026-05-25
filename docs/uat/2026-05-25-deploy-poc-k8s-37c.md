# BR-37c — Live UAT log on `poc-k8s` (sentropic tenant)

Branch: `feat/deploy-poc-k8s-37c` (continuation of BR-37b). PR #186.
Cluster: Scaleway Kapsule `poc-k8s`, namespace `sentropic`. Operator: Fabien Antoine.

## Lot 1 — Postgres backup CronJob to SCW Object Storage (2026-05-25) — DONE

### Provisioning
- Bucket `sentropic-pgbackup` created via `aws s3 mb` (S3 endpoint `https://s3.fr-par.scw.cloud`, region `fr-par`, DOC_STORAGE IAM creds reused — segmentation at the bucket boundary).
- `PG_BACKUP_BUCKET=sentropic-pgbackup` added to root `.env`.
- `deploy/scw/07-sealed-sentropic-pgbackup.yaml`: SealedSecret with `S3_ACCESS_KEY`/`S3_SECRET_KEY` (= DOC_STORAGE) + `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`. Sealed via `make scw-seal-secret`; reconciled by the live sealed-secrets controller (after delete+reapply of the unmanaged conflict, same pattern as BR-37b).

### Manifests / targets
- `deploy/scw/70-pgbackup-cronjob.yaml`: nightly `15 2 * * *`, `concurrencyPolicy: Forbid`, history 3/3. initContainer `postgres:17-alpine` dumps `pg_dump --no-owner --no-privileges` to a file, `test -s` (fails on empty), then gzip; main container `amazon/aws-cli:2.34.53` uploads to `s3://$S3_BUCKET/pg/<ts>.sql.gz`. Bucket/creds from the SealedSecret env (not hardcoded).
- `deploy/scw/15-networkpolicy.yaml`: added `allow-pgbackup-to-postgres` so `component=pgbackup` pods can reach postgres:5432 (the default-deny + api-only ingress previously blocked them).
- `Makefile` (BR37c-EX1, append-only): `scw-pgbackup-now` (create Job from cronjob + wait + show upload log), `scw-pgbackup-restore` (restore a chosen dump into a scratch `restore_check` DB, pod labelled `component=pgbackup`).

### Round-trip evidence (live)
- First attempt FAILED: dump was 20 bytes (empty) + restore timed out. Root cause: NetworkPolicy blocked pgbackup→postgres, and `pg_dump | gzip` masked the failure (gzip of empty input succeeds). Fixed (NetworkPolicy + non-piped dump + `test -s` + restore pod label).
- Second attempt GREEN:
  - `scw-pgbackup-now` → Job `pgbackup-manual-20260525155801` Complete; uploaded `pg/20260525T155806Z.sql.gz` (**12 439 bytes**, real dump).
  - `scw-pgbackup-restore PG_BACKUP_KEY=pg/20260525T155806Z.sql.gz` → restored into scratch `restore_check` DB, schema applied (ALTER TABLE …), `SELECT count(*) organizations` ran (0 rows — POC DB currently empty of org data), scratch DB dropped, "restore verification OK".
- On-cluster state confirmed: `cronjob/pgbackup` scheduled `15 2 * * *`; manual jobs Complete 1/1; backup object present in `s3://sentropic-pgbackup/pg/`.
- Note: a stale 20-byte object from the first failed attempt remains in the bucket (harmless; can be lifecycle-expired).

## Lot 2 — Public Ingress + cert-manager (Cloudflare DNS-01) — platform LIVE; app ingress authored; DNS+cert reserved

### Platform stack — delivered by the `poc-k8s` repo (cluster-wide) — DONE 2026-05-25
- Operator decision: the shared ingress controller + LoadBalancer + cert-manager + ClusterIssuers are cluster-wide platform concerns, delivered by `~/src/poc-k8s` (branch `platform/ingress-traefik-lb-cert-manager`, pushed to `rhanka/k8s-ops`), NOT by this app repo.
- LB tier: `scw lb lb-types list` (fr-par) showed the approved `LB-GP-S` (200 Mbit/s) is **not** provisionable in fr-par; available tiers are `lb-s` (100 Mbit/s), `lb-gp-m` (500), `lb-gp-l` (1G), `lb-gp-xl` (4G). Operator approved **`lb-s`** (expected matchID peak ~60-80 Mbit/s fits within 100 Mbit/s; sentropic marginal).
- Cloudflare API token: reused from `onyxia/.env` `CF_API_TOKEN` (the planned copy into sentropic root `.env` did not persist). Verified live: token **active**, permissions `dns_records:edit` + `zone:read` on zone `sent-tech.ca` (id `0ed3b4929f2881018ee2a67816075670`). Sealed into `poc-k8s/platform/40-sealed-cloudflare-token.yaml` (SealedSecret `cloudflare-api-token`, ns `cert-manager`) against the live sealed-secrets controller — plaintext never committed.
- Live apply (`make apply-platform`) GREEN: cert-manager v1.20.2 all 3 deployments rolled out; traefik v3.7.1 Deployment up; Service `traefik` (LoadBalancer) external IP **51.159.11.157**; `scw lb lb list` confirms LB type **`lb-s`** (not the account default); SealedSecret decrypted → `secret/cloudflare-api-token` present in ns cert-manager; ClusterIssuers `letsencrypt-staging` + `letsencrypt-prod` both **Ready=True** (ACME account registered).

### App ingress (this repo) — authored
- `deploy/scw/60-ingress.yaml`: single host `sentropic.sent-tech.ca` → `ui` Service (port `http`/5173); nginx in the UI image proxies `/api`→api:8787 so no API subdomain. TLS `sentropic-tls` via `cert-manager.io/cluster-issuer: letsencrypt-prod`, `ingressClassName: traefik`, websecure entrypoint.
- `make scw-dns-smoke` (BR37c-EX1): `SCW_HOST` var; asserts `https://sentropic.sent-tech.ca/` and `/api/v1/health` return 200 with a browser-trusted cert (no `-k`).

### RESERVED for operator go-ahead (BR37c-FL1)
- Create Cloudflare DNS A record `sentropic.sent-tech.ca` → `51.159.11.157` (makes the host publicly reachable — shared-infra/user-facing).
- Then `make scw-deploy SCW_INGRESS=1` → cert-manager issues the `sentropic-tls` Certificate via DNS-01 → run `make scw-dns-smoke`.

## Lot 3 — End-to-end deploy validation — partially covered, dns-smoke pending Lot 2
- Already proven elsewhere: live TEM email smoke (BR-37b Lot 1.10, post-merge), Sealed Secrets reconciliation (BR-37b Lot 2), pg backup round-trip (above).
- Pending: `scw-dns-smoke` (public host TLS) — needs Lot 2 ingress.
