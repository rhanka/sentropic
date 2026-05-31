# BR-37c — Live UAT log on `poc-k8s` (sentropic tenant)

Branch: `feat/deploy-poc-k8s-37c` (continuation of BR-37b). PR #186.
Cluster: Scaleway Kapsule `poc-k8s`, namespace `sentropic`. Operator: Fabien Antoine.

## Lot 1 — Postgres backup CronJob to SCW Object Storage (2026-05-25) — DONE

### Provisioning
- Bucket `sentropic-pgbackup` created via `aws s3 mb` (S3 endpoint `https://s3.fr-par.scw.cloud`, region `fr-par`, DOC_STORAGE IAM creds reused — segmentation at the bucket boundary).
- `PG_BACKUP_BUCKET=sentropic-pgbackup` added to root `.env`.
- `deploy/k8s/07-sealed-sentropic-pgbackup.yaml`: SealedSecret with `S3_ACCESS_KEY`/`S3_SECRET_KEY` (= DOC_STORAGE) + `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`. Sealed via `make k8s-seal-secret`; reconciled by the live sealed-secrets controller (after delete+reapply of the unmanaged conflict, same pattern as BR-37b).

### Manifests / targets
- `deploy/k8s/70-pgbackup-cronjob.yaml`: nightly `15 2 * * *`, `concurrencyPolicy: Forbid`, history 3/3. initContainer `postgres:17-alpine` dumps `pg_dump --no-owner --no-privileges` to a file, `test -s` (fails on empty), then gzip; main container `amazon/aws-cli:2.34.53` uploads to `s3://$S3_BUCKET/pg/<ts>.sql.gz`. Bucket/creds from the SealedSecret env (not hardcoded).
- `deploy/k8s/15-networkpolicy.yaml`: added `allow-pgbackup-to-postgres` so `component=pgbackup` pods can reach postgres:5432 (the default-deny + api-only ingress previously blocked them).
- `Makefile` (BR37c-EX1, append-only): `k8s-pgbackup-now` (create Job from cronjob + wait + show upload log), `k8s-pgbackup-restore` (restore a chosen dump into a scratch `restore_check` DB, pod labelled `component=pgbackup`).

### Round-trip evidence (live)
- First attempt FAILED: dump was 20 bytes (empty) + restore timed out. Root cause: NetworkPolicy blocked pgbackup→postgres, and `pg_dump | gzip` masked the failure (gzip of empty input succeeds). Fixed (NetworkPolicy + non-piped dump + `test -s` + restore pod label).
- Second attempt GREEN:
  - `k8s-pgbackup-now` → Job `pgbackup-manual-20260525155801` Complete; uploaded `pg/20260525T155806Z.sql.gz` (**12 439 bytes**, real dump).
  - `k8s-pgbackup-restore PG_BACKUP_KEY=pg/20260525T155806Z.sql.gz` → restored into scratch `restore_check` DB, schema applied (ALTER TABLE …), `SELECT count(*) organizations` ran (0 rows — POC DB currently empty of org data), scratch DB dropped, "restore verification OK".
- On-cluster state confirmed: `cronjob/pgbackup` scheduled `15 2 * * *`; manual jobs Complete 1/1; backup object present in `s3://sentropic-pgbackup/pg/`.
- Note: a stale 20-byte object from the first failed attempt remains in the bucket (harmless; can be lifecycle-expired).

## Lot 2 — Public Ingress + cert-manager (Cloudflare DNS-01) — platform LIVE; app ingress authored; DNS+cert reserved

### Platform stack — delivered by the `poc-k8s` repo (cluster-wide) — DONE 2026-05-25
- Operator decision: the shared ingress controller + LoadBalancer + cert-manager + ClusterIssuers are cluster-wide platform concerns, delivered by `~/src/poc-k8s` (branch `platform/ingress-traefik-lb-cert-manager`, pushed to `rhanka/k8s-ops`), NOT by this app repo.
- LB tier: `scw lb lb-types list` (fr-par) showed the approved `LB-GP-S` (200 Mbit/s) is **not** provisionable in fr-par; available tiers are `lb-s` (100 Mbit/s), `lb-gp-m` (500), `lb-gp-l` (1G), `lb-gp-xl` (4G). Operator approved **`lb-s`** (expected matchID peak ~60-80 Mbit/s fits within 100 Mbit/s; sentropic marginal).
- Cloudflare API token: reused from `onyxia/.env` `CF_API_TOKEN` (the planned copy into sentropic root `.env` did not persist). Verified live: token **active**, permissions `dns_records:edit` + `zone:read` on zone `sent-tech.ca` (id `0ed3b4929f2881018ee2a67816075670`). Sealed into `poc-k8s/platform/40-sealed-cloudflare-token.yaml` (SealedSecret `cloudflare-api-token`, ns `cert-manager`) against the live sealed-secrets controller — plaintext never committed.
- Live apply (`make apply-platform`) GREEN: cert-manager v1.20.2 all 3 deployments rolled out; traefik v3.7.1 Deployment up; Service `traefik` (LoadBalancer) external IP **51.159.11.157**; `scw lb lb list` confirms LB type **`lb-s`** (not the account default); SealedSecret decrypted → `secret/cloudflare-api-token` present in ns cert-manager; ClusterIssuers `letsencrypt-staging` + `letsencrypt-prod` both **Ready=True** (ACME account registered).

### App ingress (this repo) — authored
- `deploy/k8s/60-ingress.yaml`: single host `sentropic.sent-tech.ca` → `ui` Service (port `http`/5173); nginx in the UI image proxies `/api`→api:8787 so no API subdomain. TLS `sentropic-tls` via `cert-manager.io/cluster-issuer: letsencrypt-prod`, `ingressClassName: traefik`, websecure entrypoint.
- `make k8s-dns-smoke` (BR37c-EX1): `K8S_HOST` var; asserts `https://sentropic.sent-tech.ca/` and `/api/v1/health` return 200 with a browser-trusted cert (no `-k`).

### Go-public — DONE 2026-05-25 (operator approved "Go direct en prod")
- Cloudflare DNS A record `sentropic.sent-tech.ca` → `51.159.11.157` created (proxied=false, TTL 300) via CF API.
- Ingress applied; cert-manager issued `sentropic-tls` via DNS-01 in ~80s (CertificateRequest approved, Order valid, Certificate Ready=True; issuer letsencrypt-prod; Not After 2026-08-23). DNS-01 challenge `Presented=true` proved the sealed CF token works.
- Two defects found + fixed before the host served correctly:
  1. **Traefik served its default self-signed cert and 404'd** every route. Root cause in the poc-k8s platform manifest: traefik ClusterRole missing `nodes`+`configmaps` (kubernetesingress informers never synced → no config produced) AND `--providers.kubernetescrd` enabled without Traefik CRDs installed. Fixed in `poc-k8s/platform/20-traefik.yaml` (commit e0d5fa9): added the RBAC, dropped the CRD provider + its traefik.io rules. After rollout, traefik served the real `O=Let's Encrypt CN=R12` cert.
  2. **HTTPS then timed out post-handshake** (TLS OK, no HTTP response). Root cause: `sentropic` `default-deny-ingress` had no rule for Traefik→ui. Fixed by adding NetworkPolicy `allow-traefik-to-ui` (ns `traefik` → ui:5173) in `deploy/k8s/15-networkpolicy.yaml`. ui→api hop already covered by `allow-ui-to-api`; nginx in the ui image proxies `/api`→api:8787.
- **Final smoke GREEN** (`make k8s-dns-smoke`): `https://sentropic.sent-tech.ca/` → 200, `https://sentropic.sent-tech.ca/api/v1/health` → 200, both with a browser-trusted cert (`ssl_verify_result=0`).

## Lot 3 — End-to-end deploy validation — DONE 2026-05-25
- **`make k8s-deploy K8S_INGRESS=1` idempotent**: re-apply reported every manifest `unchanged`/`configured` (rbac, netpol incl. `allow-traefik-to-ui`, postgres, api, ui, ingress) — no new creates; api+ui rollout-restarted and reached Ready.
- **Live smoke matrix GREEN**:
  - `k8s-smoke` → api `/api/v1/health` OK, ui `/` OK (in-cluster port-forward).
  - `k8s-dns-smoke` → `https://sentropic.sent-tech.ca/` + `/api/v1/health` both 200, trusted cert.
  - `k8s-email-smoke` → live TEM verification email accepted for fabien.antoine@gmail.com.
  - `k8s-pgbackup-now` → uploaded `pg/20260526T011304Z.sql.gz` (12.2 KiB); `k8s-pgbackup-restore` → schema restored into scratch `restore_check`, `organizations` count read, scratch DB dropped, "restore verification OK".
- **Fix during Lot 3**: `k8s-pgbackup-restore` initially failed `Invalid bucket name ""` (it used the host `PG_BACKUP_BUCKET` make var, empty in the CI-like script env). Hardened to read `S3_BUCKET`/`S3_ENDPOINT`/`S3_REGION` from the `sentropic-pgbackup` SealedSecret (consistent with `k8s-pgbackup-now`); re-run green.
- **deploy-k8s CI apply-set**: unchanged (BR37c-EX2 not used). The job is the rolling app deploy; one-time infra (sealed secrets, pgbackup CronJob, ingress) is applied operator-side once, same model as the BR-37b sealed-secrets controller.

## CI status (PR #186)
- Branch diff is deploy-only (`deploy/k8s/**`, `Makefile` operator targets, `plan/`, `docs/`) — zero app/AI code. CI failures seen are AI-shard flakiness, a different shard each run (run 26419816448: `test-e2e (group-c,03)` chat/SSE `runtimeHeader` timeout after a digest-mismatch image rebuild; run 26426564167: `test-api-unit-integration (ai, chat-tools,…)`). Matches the documented AI flaky-accepted signature (BR-37b); rerun on the same commit. Final CI sign-off recorded at branch close.
