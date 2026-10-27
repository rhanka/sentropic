# B01 tenant runtime metadata — 21 October 2026

Owner authorization verbatim (2026-10-21): « bascule de l'app vers cluster mesh : vas y pour le kube config tenant admin, t'es censé être admin de ton tenant ».

Credential source: `K8S_TENANT_ADMIN_KUBECONFIG_B64`, selected by name only. It was decoded into a mode-600 temporary file under `/home/antoinefa/.cache-tmp/`, outside every repository, and deleted by the collection exit trap. Only `kubectl get` was run, with an explicit tenant kubeconfig and namespace. No ConfigMap/Secret `.data`, credential value, DB, object content or cluster mutation was accessed. All 18 GET calls succeeded; **no RBAC refusal** occurred. Earlier scoped-account denials in [cluster-readings.md](cluster-readings.md) remain historical observations.

Collection began at **13:10:10Z** (prod), **13:10:13Z** (preprod), **13:10:14Z** (remote), and ended at **13:10:18Z**, all on 2026-10-21 UTC. These sequential reads are a dated observation, not an atomic snapshot. No ingress/service read was requested; endpoint-to-cluster binding is not independently established in this pass.

For each namespace `sentropic`, `sentropic-preprod`, `sentropic-remote`, the standalone Make collection invoked these GET projections (30-second request timeout):

```sh
kubectl -n <ns> get pods -o 'custom-columns=NAME:.metadata.name,UID:.metadata.uid,START:.status.startTime,IMAGEID:.status.containerStatuses[*].imageID'
kubectl -n <ns> get deploy -o wide
kubectl -n <ns> get cm,secret -o 'custom-columns=KIND:.kind,NAME:.metadata.name,RV:.metadata.resourceVersion'
```

Three additional GETs per namespace projected pod ownerReferences/container names, ReplicaSet UIDs/ownerReferences, and Deployment UID/revision/requested images/config reference names. Roles below follow controller references with matching UIDs at both hops; no name-pattern inference was used. Every listed Deployment was `READY 1/1`, up-to-date 1, available 1. Prod/preprod each list only `api`, `auth-idp`, `ui`; remote lists only `control-plane`, `llm-gateway`. **No `artifact-content` or other content-role Deployment was listed in any namespace**, and all listed pods belong to these Deployments, PostgreSQL StatefulSets or backup/sync Jobs.

## Running images and pod identities

API/IdP images use repository `rg.fr-par.scw.cloud/nc-reg/sentropic-api`; UI uses `rg.fr-par.scw.cloud/nc-reg/sentropic-ui`. Remote repositories are `ghcr.io/rhanka/sentropic-remote-control-plane` and `ghcr.io/rhanka/sentropic-remote-llm-gateway`. Digests are actual container-status `imageID` values with repository prefixes omitted.

| Namespace | Deployment / container | Pod | Pod UID | Start time UTC | Image digest |
|---|---|---|---|---|---|
| sentropic | api / api | api-7b4644d4fb-ffxwk | dd6487e6-917d-4135-8491-3a4fed830769 | 2026-10-18T01:56:34Z | `sha256:f2173e9d37f525a3cef0d6148dded71765c594b775d54426486df90d82a2cbe3` |
| sentropic | auth-idp / auth-idp | auth-idp-5cd7858b5-j8hwv | cba4c683-5fb5-433c-86b7-418fed286394 | 2026-10-18T01:57:03Z | `sha256:f2173e9d37f525a3cef0d6148dded71765c594b775d54426486df90d82a2cbe3` |
| sentropic | ui / ui | ui-777fc875b4-qf94z | 3f8d55fd-180d-4796-8701-01f5753d7975 | 2026-10-18T01:56:33Z | `sha256:a3b3458814a7e91aaf1b94728d51222c1b8c35c196ec980c152c9c17e684b316` |
| sentropic-preprod | api / api | api-6c5d5874d4-dxqb4 | 0a827e83-934d-46ca-a994-f59c8791a1b9 | 2026-10-21T04:12:48Z | `sha256:bb1c2e72882e8bfeb91afb2a1af940b8c44a7cca8b764a585dcf94f91c1e8561` |
| sentropic-preprod | auth-idp / auth-idp | auth-idp-56c566899-hkj8v | 686e98d6-90be-4423-9788-f1fffd549e91 | 2026-10-21T04:12:48Z | `sha256:bb1c2e72882e8bfeb91afb2a1af940b8c44a7cca8b764a585dcf94f91c1e8561` |
| sentropic-preprod | ui / ui | ui-f97fc97f5-66kjv | 8504290d-45f9-4a65-8f07-14d35d461e77 | 2026-10-17T16:59:55Z | `sha256:a3b3458814a7e91aaf1b94728d51222c1b8c35c196ec980c152c9c17e684b316` |
| sentropic-remote | control-plane / control-plane | control-plane-7468d7f984-pt4zd | 20d155b3-6394-49fe-940a-89d01f6a318c | 2026-09-14T04:24:36Z | `sha256:3d8158d4cb5b25536dc1d15d019d0802bd321906ab6840f8a387f67cf29c1eef` |
| sentropic-remote | llm-gateway / gateway | llm-gateway-64c5bf46c4-djmkl | 99476fe9-7322-4170-9ec3-c9d0aaf74124 | 2026-09-14T04:14:38Z | `sha256:9ae2c45a7126df00859dba2942bc839ee3ecc549f394e8179cba6a19a2132cd0` |

## Verified controller chains and Deployment revisions

Each pod above has one controller ReplicaSet reference; that ReplicaSet has one controller Deployment reference. Both controller flags are `true`. Requested tags are metadata only, not digest evidence.

| Namespace | ReplicaSet | ReplicaSet UID | Deployment | Deployment UID | Revision | Requested tag |
|---|---|---|---|---|---|---|
| sentropic | api-7b4644d4fb | 3f21d2da-0c56-4438-8921-1b770e091eb1 | api | 99e6869f-15f8-47e1-9334-aa4f69953085 | 7 | main |
| sentropic | auth-idp-5cd7858b5 | bebc55f6-9bc8-4a57-81c5-98aa0e5bde48 | auth-idp | 1956e9b4-a3a9-4723-a111-a9310b95e321 | 5 | main |
| sentropic | ui-777fc875b4 | 630a428f-35b8-41af-95ce-796216af9a8a | ui | afe35167-55c5-4e82-ae93-6c88481ec858 | 5 | main |
| sentropic-preprod | api-6c5d5874d4 | 855b534c-fc53-4cc5-afda-ead7b44f0982 | api | be9a9b37-f26d-444f-8a00-4b8eada72ddc | 101 | a7c789 |
| sentropic-preprod | auth-idp-56c566899 | ff68f66e-7833-4b82-b6b5-38681d18df27 | auth-idp | ca5e6a79-d4bd-4192-8a40-44f01c66d3d5 | 96 | a7c789 |
| sentropic-preprod | ui-f97fc97f5 | 61584108-143f-4df7-b3a7-b610e6e565d1 | ui | 9a06a60e-5d6b-4ad8-983e-6d0aa28b8d19 | 22 | 44e868 |
| sentropic-remote | control-plane-7468d7f984 | c550b710-92a8-4d8b-b378-8ac14dcdd770 | control-plane | 2e74d296-188c-4e2c-9e47-4e376093c30d | 4 | main |
| sentropic-remote | llm-gateway-64c5bf46c4 | c63f922f-6caf-42ea-873f-80bb3dcb428a | llm-gateway | b90876ab-fd45-4b0d-a1f9-ab3253896b0b | 2 | main |

## Config revision names and resourceVersions

Complete namespace inventory below: names/resourceVersions only. Prod/preprod API reference ConfigMap `api` and Secret `sentropic-api` via `envFrom`; IdP references ConfigMap `auth-idp` and the same Secret. UI has no ConfigMap/Secret reference in the projected env/volume fields. Remote gateway references Secret `llm-gateway-accounts` via `env.valueFrom`; control-plane has none in those fields. ResourceVersions describe API objects at collection time; they do not prove which values a previously started process consumed. Rendered config hashes remain uncollected under the metadata-only restriction.

| Kind / name | sentropic RV | sentropic-preprod RV | sentropic-remote RV |
|---|---|---|---|
| ConfigMap / api | 41220239107 | 40034497621 | — |
| ConfigMap / auth-idp | 39542608449 | 40079346299 | — |
| ConfigMap / kube-root-ca.crt | 39542411153 | 39578308988 | 39577474672 |
| ConfigMap / postgres | 39542608466 | 39578320237 | — |
| ConfigMap / ui | 39542608493 | 39578320596 | — |
| ConfigMap / sentropic-idp-identity-export-sql | 41065204870 | — | — |
| ConfigMap / sentropic-idp-reader-role-sql | 41061125912 | — | — |
| ConfigMap / sentropic-idp-identity-sync-sql | — | 41216325350 | — |
| ConfigMap / llm-gateway-sticky | — | — | 39577478235 |
| Secret / auth-idp-tls | 40727483802 | 40765523214 | — |
| Secret / ci-deployer-token | 41281006240 | 41283586590 | 39580521710 |
| Secret / sentropic-api | 39664445285 | 39678949374 | — |
| Secret / sentropic-docs-bhs | 39664140666 | — | — |
| Secret / sentropic-idp-identity-reader | 40944343961 | — | — |
| Secret / sentropic-idp-relay-writer | 40944343884 | — | — |
| Secret / sentropic-idp-relay-reader | — | 40931480207 | — |
| Secret / sentropic-pgbackup | 39624468973 | 39624469110 | — |
| Secret / sentropic-postgres | 39542423077 | 39578317147 | — |
| Secret / sentropic-registry | 39542423383 | 39578318152 | — |
| Secret / sentropic-tls | 40727479841 | 40765528328 | — |
| Secret / geo-acquisition-creds | — | — | 39577475471 |
| Secret / ghcr-pull-secret | — | — | 39577476207 |
| Secret / llm-gateway-accounts | — | — | 39577477021 |
| Secret / llm-gateway-tls | — | — | 40764838367 |

## Remaining evidence access

**B02 remains pending:** separately scoped authenticated read-only PostgreSQL access with SELECT on actual product/control migration journals and checksums, package journals, and author/generation/cutover/server/lease/fence state. Kubernetes metadata grants no DB access; no DB connection or query was attempted.

**B03 remains pending:** read-only backup catalogue/object checkpoint metadata (timestamps, versions/checksums and private-access policy evidence) plus retained isolated-restore receipts that bind the current DB/object baseline and restored grants/revocations. Backup pod presence/image is not a verified backup or restore receipt. No backup, object or restore action was attempted. B04, B06 reconciliation and B08 independent final-head acceptance remain as specified in [authorization.md](authorization.md).
