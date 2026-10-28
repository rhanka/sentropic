# Artifact content infrastructure handoff

W3.d prepares manifests only. No cluster apply, DNS change, certificate issuance,
credential provisioning, live activation or production acceptance is evidenced here.
The API remains the sole migration executor. The content process starts the compiled
W3.c entrypoint from the same canonical API/IdP/content image.

## Closed serving contract

The API and content Deployment explicitly set `APP_ARTIFACT_HOST_ENABLED`,
`APP_ARTIFACT_CONTENT_ENABLED` and `APP_ARTIFACT_READER_ENABLED` to `0`. Explicit
container environment values override any enabled values in `envFrom` secrets.
Both overlays inherit these values, including automatic main deployments. Updating
the image or provisioning secrets cannot open serving, publication or activation.
The content ConfigMap also declares the closed values for inspection.

Without runtime secrets the closed process can start: `/healthz` returns `200`;
other paths return `404` without a cookie or private body. W3.c's production image
test qualifies this behavior. W3.d tests the rendered configuration that selects it.
Optional runtime/signing secrets allow this health/denial phase before provisioning;
the real entrypoint refuses enabled startup with incomplete credentials.

## Tenant DNS and TLS receipts

| Environment | Namespace | Stable wildcard | Pinned wildcard |
| --- | --- | --- | --- |
| Production | `sentropic` | `*.sentropic.sent-tech.ca` | `*.pinned.sentropic.sent-tech.ca` |
| Preprod | `sentropic-preprod` | `*.preprod.sentropic.sent-tech.ca` | `*.pinned.preprod.sentropic.sent-tech.ca` |

The tenant operator must supply DNS-01/Cloudflare issuance receipts for both SANs
in each namespace's `artifact-content-tls` secret, through the existing
`letsencrypt-prod` ClusterIssuer. A stable wildcard does not cover the pinned
depth. Supply DNS records to the platform Traefik load balancer and measure
propagation separately. No address or issuance completion is assumed here.
The dedicated Ingress uses only `websecure`, preserves Host and has priority `1`
so existing exact app/IdP/preprod routes retain precedence over the wildcard.
Unknown labels are denied by the content host; no forwarded identity is trusted.

## Credentials, storage and network receipts

Provision namespace-local `artifact-content-runtime` with `DATABASE_URL`,
`APP_ARTIFACT_S3_BUCKET`, `APP_ARTIFACT_S3_REGION`, optional
`APP_ARTIFACT_S3_ENDPOINT`, `APP_ARTIFACT_S3_ACCESS_KEY_ID` and
`APP_ARTIFACT_S3_SECRET_ACCESS_KEY`. Use a dedicated bucket-read credential;
never reuse app, backup, D2, production or cross-environment credentials. Supply a
separate `artifact-content-signing` secret whose `key` is at least 32 random bytes.
The projected file is group-readable by UID/GID 1000 and mounted read-only. Record
rotation/revocation receipts without copying secret values into this repository.

The tenant database role must support content reads/current authority checks and
the upstream activation flow/ticket transaction, with no schema migration or
publication authority. The workload has no Kubernetes API token or role binding.
Network policy admits only the platform Traefik pods on TCP 8791 and egress to
namespace-local PostgreSQL on TCP 5432 plus cluster DNS on UDP/TCP 53. Confirm
platform Traefik `app.kubernetes.io/name=traefik` and DNS `k8s-app=kube-dns` labels.
Same-label pods in the other app namespace receive no access.

Object-store egress intentionally remains closed until the tenant supplies the
approved destination ranges/egress gateway and storage IAM/private-object receipt.
A reviewed environment-specific network change is required before enabling;
do not add unrestricted `0.0.0.0/0:443`. Keep anonymous object reads denied and
bind bucket/version/checksum checkpoints to the W0 isolated restore procedure.
The existing namespace-local `pgbackup` ingress is preserved; content gets no
backup credential or restore-job authority. After restore, invalidate old
activation state/grants through the existing W1 package/host recovery procedure.

## Image and activation gates

Kustomize image replacement uses the same `sentropic-api` name for all three roles.
Tests substitute a synthetic digest to prove replacement coverage; it is never a
deployable release receipt. Existing main CD supplies the canonical immutable
content-hash tag. W5 must pin the actual tested/published registry digest, verify
API/IdP/content equality and record config/render hashes before promotion.
No new image is built or published by this manifest lane.

Opening any live Sentropic artifacts surface, including preprod, requires the
timestamped FIRST-IMMO real HTTPS activation receipt from Radar A6/A7 first.
W3.e then qualifies the real HTTPS sibling-origin/activation matrix. W5 retains
the production owner gate. An explicit reviewed change to the container flags is
required; a receipt, secret or image update alone never opens them. Rollback closes
all flags, fences/drains grants and restores the prior qualified image/config.

Run offline qualification through `make test-artifact-content-manifests
API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d` under the shared
Docker flock, then `make down ENV=test-app-w3d`. The render containers have no
network and mount no kubeconfig; tests never contact a cluster.
