# Ops job-failure notify (L1) — preprod wiring runbook

Scope: PREPROD ONLY. Namespace `sentropic-preprod` on the sentropic side, target
`immo-preprod` on the immo side. The `sentropic` (prod) namespace is never touched.
This file carries names, refs and dates only, never a value.

## 1. Credential names

Central store: `/home/antoinefa/src/sentropic/.env`, git-ignored, mode `0600`.
Every `*_PREPROD` variable below holds one 64 lowercase hex value (32 random bytes,
`openssl rand -hex 32`), minted per §4. Values are never printed, logged or committed.

| Central `.env` name | Content | Lands in |
| --- | --- | --- |
| `OPS_JOB_FAILURE_RECIPIENTS_BEARER_PREPROD` | Bearer the platform presents to product recipients URLs | k8s Secret `sentropic-api` in `sentropic-preprod`, key `OPS_JOB_FAILURE_RECIPIENTS_BEARER` |
| `OPS_JOB_FAILURE_INGEST_SECRET_PREPROD` | OAuth `client_credentials` secret of the ingest client | Preprod `service_clients` row for `immo-preprod-ops-ingest` (sha256 hash stored, never the value); handoff copy to immo |
| `OPS_JOB_FAILURE_INGEST_CLIENT_ID_PREPROD` | Client id, not secret: `immo-preprod-ops-ingest` | `OPS_JOB_FAILURE_INGEST_CLIENTS_JSON` allowlist (ConfigMap) |

The k8s Secret key for the bearer is exactly `OPS_JOB_FAILURE_RECIPIENTS_BEARER`
(the code's env name, read through the Deployment `envFrom` secretRef). The bearer
is never placed in a ConfigMap.

## 2. Preprod config (IaC)

File: `deploy/k8s/overlays/preprod/patch-api-config.yaml` (strategic-merge patch on
the `api` ConfigMap, which is not hash-suffixed).

| Key | Value | Notes |
| --- | --- | --- |
| `OPS_JOB_FAILURE_INGEST_CLIENTS_JSON` | `{"immo-preprod-ops-ingest":{"targets":["immo-preprod"],"sources":["app"]}}` | Dedicated immo emitter, source `app`. No `'*'` target, no k8s-watcher entry (L2 does not exist yet). Unset denies every ingestion with `403` before any write. |
| `OPS_JOB_FAILURE_RECIPIENTS_URLS_JSON` | `{"immo-preprod":"https://preprod.immo.sent-tech.ca/api/v1/ops/recipients"}` | Base URL only: the fetcher appends `?target=<productKey>` itself (`packages/cluster-mesh/src/notifications/recipients-http.ts`). `OPS_JOB_FAILURE_TARGETS_JSON` stays unset (pull path, no platform declaration). |
| `OPS_JOB_FAILURE_RECIPIENTS_BEARER` | Not set here | Secret only, see §1. Boot fails closed when URLs are configured without a bearer. |

Apply, then restart (the ConfigMap update restarts nothing on its own):

```bash
kubectl apply -k deploy/k8s/overlays/preprod
kubectl rollout restart deploy/api -n sentropic-preprod
```

Always with the tenant admin kubeconfig from `K8S_TENANT_ADMIN_KUBECONFIG_B64`
(decoded to a `0600` file, deleted after use), and `-n sentropic-preprod`.

## 3. Ingest service client (preprod IdP database)

Client id `immo-preprod-ops-ingest`, tenant `sentropic`, scopes exactly
`service:ops-job-failure-ingest`, resource indicator
`https://preprod.sentropic.sent-tech.ca`. Least privilege: this credential carries
no broker or builder scope. Registration only through the governed one-off Job,
never a manual SQL edit:

```bash
umask 077; f="$(mktemp)"; kc="$(mktemp)"; trap 'rm -f "$f" "$kc"' EXIT
sed -n 's/^K8S_TENANT_ADMIN_KUBECONFIG_B64=//p' /home/antoinefa/src/sentropic/.env \
  | tr -d '"' | base64 -d > "$kc"
printf 'OAUTH_SERVICE_CLIENT_ID=immo-preprod-ops-ingest\nOAUTH_SERVICE_CLIENT_SCOPES=service:ops-job-failure-ingest\nOAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS=https://preprod.sentropic.sent-tech.ca\nOAUTH_SERVICE_CLIENT_SECRET=%s\n' \
  "$(sed -n 's/^OPS_JOB_FAILURE_INGEST_SECRET_PREPROD=//p' /home/antoinefa/src/sentropic/.env)" > "$f"
chmod 600 "$f"
make oauth-register-service-client-job SECRET_FILE="$f" \
  OAUTH_SERVICE_CLIENT_JOB_NAMESPACE=sentropic-preprod KUBECONFIG="$kc" ENV=<env>
```

The Job image defaults to the namespace's running `api` image, so register only
after the deployed image contains the `service:ops-job-failure-ingest` scope in
`KNOWN_SERVICE_CLIENT_SCOPES`. The Job and its temporary Secret are deleted on exit
even on failure. The scope `service:ops-job-failure-ingest` must stay registered in
`api/src/services/auth/service-client-provisioning.ts` (`KNOWN_SERVICE_CLIENT_SCOPES`).

## 4. Rotation cycle

Cycle: 90 days for both credentials, immediately on suspected exposure.
Minted 2026-11-11; rotate before 2027-02-09.

Bearer rotation (no immo downtime when sequenced):

1. Mint the replacement with `openssl rand -hex 32` into a `0600` scratch file.
2. Hand the new bearer to immo; immo deploys acceptance on its recipients endpoint.
3. Replace `OPS_JOB_FAILURE_RECIPIENTS_BEARER_PREPROD` in central `.env` (preserve
   mode `0600`, other lines byte-identical).
4. Patch key `OPS_JOB_FAILURE_RECIPIENTS_BEARER` in Secret `sentropic-api`,
   namespace `sentropic-preprod`, then `rollout restart deploy/api`.
5. Verify one sweep pulls recipients for `immo-preprod` without a config alert.

Ingest secret rotation:

1. Mint the replacement and update `OPS_JOB_FAILURE_INGEST_SECRET_PREPROD` in
   central `.env` as above.
2. Re-run the §3 command with the new secret file plus
   `OAUTH_SERVICE_CLIENT_ROTATE_SECRET=true` appended to the `SECRET_FILE`
   (the wrapper accepts only `OAUTH_SERVICE_CLIENT_*` lines).
3. Hand the new secret to immo; verify one `succeeded` heartbeat emission is accepted.

## 5. Failure modes (fail-closed reference)

- No `OPS_JOB_FAILURE_INGEST_CLIENTS_JSON`: every ingestion refused `403`, zero writes.
- Client outside its targets or sources: `403 forbidden_target`, zero writes.
- Product URL configured without bearer: api refuses to boot (missing
  `OPS_JOB_FAILURE_RECIPIENTS_BEARER`).
- Recipients pull failing or stale: sweep retries bounded, then marks the delivery
  `failed` visibly and raises a `config` alert to platform admins; incident mail is
  never rerouted.
- Queue per target full (200 pending): `429 queue_full`, nothing written, replayable
  with the same `eventId`.
