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

## Lot 2 — Public Ingress + cert-manager (Cloudflare DNS-01) — BLOCKED on architecture/cost decision
- Cluster is bare: no ingress controller, no LoadBalancer, cert-manager namespace exists but is EMPTY (no controller/CRDs).
- Cloudflare API token: an existing valid token (zone `sent-tech.ca`, id `0ed3b4929f28…`) was found in `spa-transpose-cv/.env` and copied to root `.env` as `CLOUDFLARE_API_TOKEN` (reused, no new token created).
- Open decision: a public ingress needs a SCW LoadBalancer (flat monthly, traffic unlimited, priced by throughput): LB-GP-S ~11.68€/mo (200 Mbit/s), LB-GP-M ~27€/mo (500 Mbit/s). One shared LB fronts all cluster apps (matchID + sentropic) — sentropic adds ~0 marginal cost. Awaiting operator decision on tier (or defer).

## Lot 3 — End-to-end deploy validation — partially covered, dns-smoke pending Lot 2
- Already proven elsewhere: live TEM email smoke (BR-37b Lot 1.10, post-merge), Sealed Secrets reconciliation (BR-37b Lot 2), pg backup round-trip (above).
- Pending: `scw-dns-smoke` (public host TLS) — needs Lot 2 ingress.
