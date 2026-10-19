# F1 read-only cluster observations and access limits

Collection date: **19 October 2026 UTC**, `AGENT_SIG:7f3a9c2e1b`. Existing kubeconfigs were passed explicitly to read-only GETs; no credential was exported, no Secret resource read, and no pod exec, restart, apply, migration or backup action performed. The accessible Scaleway objects below have **zero replicas and zero pods**. They cannot identify the images serving the public app/preprod endpoints. B01/B02 remain open for the actual serving tenant cluster.

The standalone [readings.mk](readings.mk) contains the complete commands and output projections. Commands below use `rtk make -f docs/baselines/app-cm-w0/readings.mk <targets> <arguments> ENV=test-app-cm-w0`. It loads no repository `.env`; default `W0_KUBECONFIG=/home/antoinefa/.kube/config` points to cluster `poc-979c11ad-9f84-4847-a334-c42a5e797976` at `979c11ad-9f84-4847-a334-c42a5e797976.api.k8s.fr-par.scw.cloud:6443`.

| Reading | UTC timestamp | Targets and arguments / result |
|---|---|---|
| Scaleway production deployment/pod inventory | 00:15:32 / 00:15:34 | `w0-roles W0_NS=sentropic`; three Deployments, zero pods |
| Scaleway preprod deployment/pod inventory | 00:15:32 / 00:15:34 | `w0-roles W0_NS=sentropic-preprod`; three Deployments, zero pods |
| ConfigMap metadata/hashes, pod-template hashes/reference names | 00:14:47 / 00:14:48 | `w0-config W0_NS=sentropic`, and `w0-config W0_NS=sentropic-preprod` |
| Existing backup workload status, both namespaces | 00:15:34 | `w0-backup-status W0_NS=sentropic`, and `w0-backup-status W0_NS=sentropic-preprod` |
| OVH production access denial | 00:20:13 | `w0-roles W0_KUBECONFIG=/home/antoinefa/.kube/ovh.conf W0_NS=sentropic`; Forbidden |
| OVH preprod access denial | 00:15:32 | `w0-roles W0_KUBECONFIG=/home/antoinefa/.kube/ovh.conf W0_NS=sentropic-preprod`; Forbidden |
| Public hostname, old ingress and local DB access cross-check | 00:20:13 | `w0-access`; DNS returned `51.79.100.177`, both expected app/IdP ingress names had empty loadBalancer status, PG connection variables were unset and both PostgreSQL credential/service files absent |

All six Deployments have desired replicas **0**; no pod UID/start time/`imageID` exists in these namespace pod lists. No content Deployment was listed there. Absence on this cluster does not establish content-role absence on the serving cluster. Requested images use prefix `rg.fr-par.scw.cloud/nc-reg/`:

| Namespace | Role | Deployment UID | Generation / revision | resourceVersion | Requested image suffix |
|---|---|---|---|---|---|
| sentropic | api | `01fdb517-bd1f-4396-b17c-787ac82330ae` | 80 / 75 | 47343087768 | `sentropic-api:main` |
| sentropic | auth-idp | `aed70d65-c1ab-4762-aa4a-2bc1a9181603` | 24 / 23 | 47343087831 | `sentropic-api:main` |
| sentropic | ui | `ac0619e6-316b-4175-9429-085aad81a84a` | 66 / 65 | 47343087808 | `sentropic-ui:main` |
| sentropic-preprod | api | `b433df44-fb5e-49ce-b225-b712efee5792` | 55 / 52 | 47357356599 | `sentropic-api:86004f` |
| sentropic-preprod | auth-idp | `ad44c789-fd7d-42c3-bb7f-e5b2cfa2869a` | 53 / 50 | 48148799671 | `sentropic-api:86004f` |
| sentropic-preprod | ui | `27c63b18-3977-4b51-a5dc-d9ce04dd167c` | 19 / 16 | 47357344487 | `sentropic-ui:0921a5` |

ConfigMap SHA-256 is over `jq -Sc '{data,binaryData,immutable}'` including its final newline; values are never emitted. The observations are resource versions of these inactive-cluster objects, not current serving configuration or complete rendered configuration:

| Namespace | ConfigMap | UID | resourceVersion | SHA-256 |
|---|---|---|---|---|
| sentropic | api | `80b5f064-597b-41ab-9cc4-a76f412961f3` | 45434384180 | `ad87afa1390c3e4b905e0c1a8207ad9de483423aea687d0feda3b479e44cc508` |
| sentropic | auth-idp | `1d5d3ff3-8a01-4363-ac47-daed0c77bed9` | 45648490286 | `fd44d070c3d8b3d4ac1d54da848ecdd56cfd642aa0d40e734da463af4dc697cf` |
| sentropic | postgres | `e30ea5ed-f25b-439c-b0a4-6406774e9762` | 45226837482 | `128dc4f511234f4c434f4114d5b99a6335495b5f5f9fabcb774ed8b29f620680` |
| sentropic | ui | `0b8013be-3713-42ad-adda-e0c997c89dea` | 45226838563 | `42a15cc3d368e487c2e620a42c50079359f794a34522a3f4887e295323ce92c5` |
| sentropic-preprod | api | `8299e916-40b8-4011-8a8a-8a19f2631f95` | 46144006432 | `955f669b8d171c2d793008f20d907750ef7d7a2ea1c3fc399043d5af3e408d24` |
| sentropic-preprod | auth-idp | `0d2bd351-fd9a-48b0-a03e-dfc8ba32a685` | 48148798891 | `14bc619b5e2195943672efacbcdd8c81e00da6f2667761e3334cbd85b364884d` |
| sentropic-preprod | postgres | `8589e737-0cfb-486f-b2a1-1515d29f57e2` | 46144006627 | `128dc4f511234f4c434f4114d5b99a6335495b5f5f9fabcb774ed8b29f620680` |
| sentropic-preprod | ui | `08f71035-d8cc-4ffa-92d8-8e9386dc4fe8` | 46144006724 | `42a15cc3d368e487c2e620a42c50079359f794a34522a3f4887e295323ce92c5` |

Pod-template SHA-256 uses `jq -Sc '.spec.template'`: production API `0886ed05ffc826372186a9650850867fd26afd8ba3cd95bef90ecc417b6de722`, IdP `6cdc92cf7b5c8ee5bc85119973c6446dff76f786a123fa4726ba37f826d620a3`, UI `db5dd1b7014c6e4ee9faf2f15e59092fda15c692701918bcab2dc0c0fa3b7f9b`; preprod API `44605ea3af11664e66460ea12c2fb1decfdb667e0069b7beaa562707e5b04f2d`, IdP `498341af15ddbc2ca1a85ddab36409c57c4f6005de0f8bca0fdf0efb7d09ef41`, UI `991af35e8ecd095872e93fb2fbe74752ded3e023c2458d7039c5e82d1754e80b`. API/IdP reference their namesake ConfigMap and Secret name `sentropic-api`; only reference names were emitted. Secret revisions/values were not read.

Production `pgbackup` UID `c2910066-f9bb-450a-b4bd-f409c040d8c9`, resourceVersion `47422098927`, is suspended; its last successful timestamp is **27 July 13:48:33**. Jobs `pgbackup-29749095`, `-29750535`, `-29751975` have success conditions; `-29753415`, `-29754855`, `-29756295` have failure conditions. Preprod `pgbackup` UID `38325ad6-21ea-40b1-9f9e-7b99781e9ecf`, resourceVersion `46471628088`, is suspended with no last success. Both schedules are `15 2 * * *`. These old-cluster statuses prove neither current backup coverage nor recovery; see [existing archive/CI receipts](recovery-readings.md).

## Exact access still missing

- **B01:** a tenant-approved reader on the serving cluster, with `get/list` for pods, deployments/replicasets, ConfigMaps, services/ingresses and existing jobs/cronjobs in `sentropic` and `sentropic-preprod`, plus confirmation tying those namespaces/cluster to the public endpoints. OVH endpoint `hlhedx.c1.bhs5.k8s.ovh.net` is locally configured, but its `system:serviceaccount:geo:ci-deployer` is explicitly denied deployment listing in **both** namespaces. The separate `geo-admin.conf` and other-tenant reader credentials are not substituted. Current role digests, content presence and config revisions remain unread.
- **B02:** an authenticated PostgreSQL read-only connection/role to each actual product/control database, with SELECT on both migration journals, the relevant package journals and author/generation/cutover/server/lease records. No such DSN/service/passfile is supplied. The 00:20:13 `w0-access` inspection found PG connection variables unset and `~/.pg_service.conf`/`~/.pgpass` absent; no credential values were printed. Kubernetes access does not grant DB SELECT. `make db-query` depends on `up`; production backup/restore targets use writes or pod exec, so none was run.
- **B03/B04:** scoped read-only backup/object catalogue and existing isolated-restore receipt access, and current aggregate DB/object/ACL inventory for the four legacy stores; [recovery-readings.md](recovery-readings.md) details what the existing local evidence does establish. No object-store access for these app stores was identified; relay/session and unrelated tenant credentials are outside this inventory.

No denied query was worked around by switching to an administrator identity. F1 and F2 remain partially evidenced, with the above missing reads and disposition gates explicit.
