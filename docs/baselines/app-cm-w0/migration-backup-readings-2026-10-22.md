# B02/B03 migration and backup readings — 22 October 2026

Owner authorization (AskUserQuestion, 2026-10-22), verbatim: « Oui, lecture seule ». Scope: migration-bookkeeping SELECTs through existing PostgreSQL pods and backup catalogue/status/receipt reads in prod and preprod, with nothing modified. No application rows, migrations, backup creation, object download, restore or deletion. A restore test remains **pending and outside this task**.

Branch `feat/app-cm-w0-baseline`, PR #702, collection source HEAD `7e9a5b284abb654713e01beee4e3af4d1e088dbd`: `harness check branch` passed before work and after `git pull --ff-only` (already up to date); worktree initially clean. Collection commands ran through standalone Make targets; environment `test-app-cm-w0`, no services started.

Credential source: `K8S_TENANT_ADMIN_KUBECONFIG_B64` from the root `.env`, selected by name only. Each of four collection passes decoded it to a mode-600 temporary file under `/home/antoinefa/.cache-tmp/`, verified its mode and removed it with an exit trap. No credential values or DB passwords were printed or placed in command arguments. Kubernetes calls used explicit kubeconfig/namespace and a 30-second request timeout. **No access refusal occurred.**

## B02 — applied migration frontier

Discovery ran **18:35:25–18:36:05Z**; count/frontier queries ran **18:36:15–18:37:23Z**, sequentially across prod then preprod. These are dated reads, not an atomic snapshot or schema validation.

| Namespace / database | Existing pod | Pod UID | Pod start UTC |
|---|---|---|---|
| `sentropic` / `app` | `postgres-0` | `94a03326-3ed7-4e8a-906d-f931e627e367` | 2026-10-18T01:56:33Z |
| `sentropic-preprod` / `app` | `postgres-0` | `d70d8064-7f53-4668-888b-565668b88355` | 2026-09-20T21:28:14Z |

Each `kubectl exec -i postgres-0 -c postgres` ran `psql -X -w -v ON_ERROR_STOP=1 -P pager=off`, using the existing container's `POSTGRES_USER`/`POSTGRES_DB` through the local socket; both reported database/role `app`. `PGOPTIONS=-c default_transaction_read_only=on` applied before connection, and the first SQL statement was `SET default_transaction_read_only=on;`; every session confirmed `current_setting('default_transaction_read_only') = on` before SELECTs. No password retrieval was needed.

First, SELECTs on `information_schema.tables` (base tables with `table_name ILIKE '%migration%'`) and `information_schema.columns` found exactly these two migration tables in each DB: `drizzle.__drizzle_migrations` and `public.__drizzle_control_migrations`. Both contain `id integer`, `hash text`, `created_at bigint`. No separate package migration table was returned by that search; other journal naming conventions were not investigated.

For each discovered table, only `SELECT count(*), max(id), max(created_at)` and `SELECT id, hash, created_at ... ORDER BY created_at DESC, id DESC LIMIT 1` followed. No application table was queried.

| Namespace / database | Stream / table | Count / max ID | Max `created_at` | Latest row SHA-256 | Matching source migration |
|---|---|---|---|---|---|
| `sentropic` / `app` | product / `drizzle.__drizzle_migrations` | 44 / 44 | 1792201313001 | `23a01a36ad15b1321bea3ca98cc374b7d07858c3206c1cceef5efb0b34458396` | `0043_immo_token_exchange` |
| `sentropic` / `app` | control / `public.__drizzle_control_migrations` | 11 / 11 | 1791860000000 | `899d168ba7d859c87d2eeded76010267e66e64bb9f079c4c53ab601db6756b00` | `0010_live_git_declarations` |
| `sentropic-preprod` / `app` | product / `drizzle.__drizzle_migrations` | 44 / 44 | 1792201313001 | `23a01a36ad15b1321bea3ca98cc374b7d07858c3206c1cceef5efb0b34458396` | `0043_immo_token_exchange` |
| `sentropic-preprod` / `app` | control / `public.__drizzle_control_migrations` | 11 / 11 | 1791860000000 | `899d168ba7d859c87d2eeded76010267e66e64bb9f079c4c53ab601db6756b00` | `0010_live_git_declarations` |

Latest-row IDs equal the max IDs above. Local `sha256sum` on the corresponding SQL files matches each live frontier hash; source `_journal.json` entries match the `created_at` values. Drizzle IDs are not filename numbers: product ID 44 maps to `0043`; control ID 11 maps to `0010`. The control source journal orders `0011_session_workspace_bindings` (`when=1791855645000`, idx 9) before `0010_live_git_declarations` (`when=1791860000000`, idx 10). Therefore the timestamp frontier is `0010`, not the greatest filename number. `created_at` is the migration journal timestamp, not a measured deployment time. Counts/frontier matching do not independently validate every older checksum or the resulting schema.

B02's separate package-journal and author/generation/cutover/server/lease/fence evidence remains pending: application/control state tables were outside the authorized migration-bookkeeping reads.

## B03 — latest backup receipts

CronJob/Job/pod metadata ran **18:37:31–18:38:28Z**; retained upload/dump log receipts ran **18:38:38–18:39:46Z**. The read path was `kubectl get cronjobs`, `get jobs/pods -l app.kubernetes.io/component=pgbackup`, then `kubectl logs job/pgbackup-29877255 -c upload` / `-c dump --timestamps --tail=10`. No new Job or pod was created, and no S3 object was fetched. Only backup names, status, times and file-size metadata are retained here.

Both live `pgbackup` CronJobs have schedule `15 2 * * *`, `suspend=false` and last schedule `2026-10-22T02:15:00Z`. Both retain successful jobs `pgbackup-29874375` (20 Oct), `pgbackup-29875815` (21 Oct) and `pgbackup-29877255` (22 Oct); each has succeeded count 1, no failed count, and `SuccessCriteriaMet,Complete` conditions. The latest pods are `Succeeded`, with upload image `peakcom/s5cmd:v2.2.2@sha256:6e551552f7c6ffde461e3cfe6fab82cd3345b574bd256193194081fd9022da4a`.

| Receipt field | Prod / `sentropic` | Preprod / `sentropic-preprod` |
|---|---|---|
| CronJob UID / resourceVersion | `58d39758-814b-41ce-a486-7cdf9fc20ba3` / `41302456974` | `168ea6f4-f8bb-4f0c-9e4e-0618f0eee0d9` / `41302454965` |
| Latest Job / UID | `pgbackup-29877255` / `a7d4a974-4016-4bc2-9961-540369704bc4` | `pgbackup-29877255` / `6acb6ca6-3801-4977-8197-44c08139fc68` |
| Latest pod | `pgbackup-29877255-95tlj` | `pgbackup-29877255-52gxm` |
| Job start UTC | 2026-10-22T02:15:00Z | 2026-10-22T02:15:00Z |
| Job completion / CronJob last success UTC | 2026-10-22T02:15:18Z | 2026-10-22T02:15:10Z |
| Upload receipt UTC | 2026-10-22T02:15:16.217628410Z | 2026-10-22T02:15:07.505786788Z |
| Uploaded object named by receipt | `s3://sentropic-pgbackup/pg/20261022T021501Z.sql.gz` | `s3://sentropic-pgbackup-preprod/pg/20261022T021502Z.sql.gz` |
| Gzip size shown by dump receipt (`ls -lh`) | `1.4M`, 2026-10-22T02:15:07.613039221Z | `35.3K`, 2026-10-22T02:15:03.221449243Z |
| Exact bytes / checksum / object version | Not listed | Not listed |

These are the latest successful scheduled backup/upload receipts observed in each namespace, not an S3 listing, HEAD verification, restore qualification or proof that no later manual object exists. Object-store last-modified time, exact bytes, checksum/version, current private application-object checkpoint and ACL/deny-state recovery binding remain **pending**. Object-store credentials were not used. The retained sizes are rounded source-file sizes, not independently measured object sizes. Historical SQL restore evidence remains in [recovery-readings.md](recovery-readings.md); no restore test was performed here.

## Remaining W0 gates

As detailed in [authorization.md](authorization.md): B01 endpoint/config-hash remainder; B02 package journals and runtime authority/fence state; B03 private-object/checksum/restore evidence; B04 current scoped inventory, ACL mapping and disposition; B06 nonlocal migration-0017 reconciliation; B08 independent exact-head acceptance reviews. This collection closes only the applied product/control frontier and latest scheduled-backup receipt subgates. It grants no merge, deployment or downstream dispatch approval.
