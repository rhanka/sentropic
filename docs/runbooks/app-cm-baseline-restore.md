# App CM baseline restore (isolated) — W0-close.b runbook

Lot W0-close.b of `plan-v2.md`. This runbook documents the ISOLATED restore
mechanism (`make k8s-pgbackup-restore`) and its B03 manifest. Execution against
a real cluster is W0-close.c, performed by the tenant — not by this lot.

## 1. What the target does

### Schema rollback after app integration

Keep `APP_ARTIFACT_HOST_ENABLED`, `APP_ARTIFACT_CONTENT_ENABLED` and
`APP_ARTIFACT_READER_ENABLED` explicitly at `0`, then revert API/content images
and configuration to the previously qualified closed release. Migration
`0020_app_artifact_host.sql` is additive: retain `control.artifact_host_kv`,
the nullable unique control-journal `asset_id` column and migration receipts.
There is no down migration; do not drop those objects, delete receipts or
rewind either journal to roll back an image. Retain artifact tables and private
blobs so a later forward deployment can reconcile their existing state.
API remains the only migration executor; content never executes migrations.
Logical data recovery is a separate isolated, verified restore operation;
an image revert is not a claim that data or schema was restored.

1. Runs every guard BEFORE any `kubectl` write: backup-key shape, identity,
   namespace, PG host, DB name and bucket checks (full list in section 4).
2. Reads the backup source bucket from the restore-namespace credential only.
3. Runs one short-lived pod in the restore namespace that downloads the
   object, records bytes plus sha256, restores into the isolated DB, runs
   strict verification queries (any failure aborts, nothing is swallowed) and
   prints a `MANIFEST-BEGIN ... MANIFEST-END` B03 block.
4. Drops the restored DB unless `RESTORE_KEEP_DB=true`.

It never writes to the prod/preprod namespaces, PG services, DBs or buckets.
`k8s-db-restore-preprod` (which overwrites preprod) is a different target and
stays excluded.

## 2. Provisioning and confirmation (k8s, before W0-close.c)

k8s provisions the following and records the actual allocated values. The
tenant confirms each actual value before running; proposed defaults are the
plan-v2 handoff and must never resolve to prod/preprod.

| Item | Proposed default | Confirm actual |
| --- | --- | --- |
| Namespace | `sentropic-restore-app-cm` | |
| PG service | `postgres-restore` | |
| PG database | `app_cm_restore` | |
| Restore PG role credential | secret `postgres-restore`, key `POSTGRES_PASSWORD` | |
| Backup-object read-only credential | secret `app-cm-restore-backup-ro` (`S3_*` keys) | |
| Dedicated namespace kubeconfig | path on the tenant machine | |
| NetworkPolicy/RBAC denying prod/preprod DB writes | applied | |

Credentials live in the tenant's ignored `.env`-style files and are referenced
by name only; they are never printed and never stored in receipts.

## 3. Exact tenant command (W0-close.c)

Run from the repo root, with the confirmed values exported as make variables
(the example uses the proposed defaults plus the tenant's kubeconfig path):

```bash
run_id="restore-$(date -u +%Y%m%dT%H%M%SZ)"
receipt_dir="${RESTORE_RECEIPT_DIR:-/tmp/app-cm-restore-receipts}"
mkdir -p "${receipt_dir}"
make k8s-pgbackup-restore \
  PG_BACKUP_KEY=pg/<timestamp>.sql.gz \
  PG_BACKUP_SHA256=<64-hex-digest-of-the-object> \
  RESTORE_KUBECONFIG=<path-to-restore-namespace-kubeconfig> \
  RESTORE_KEEP_DB=true \
  ENV=test-app-w0-restore > "${receipt_dir}/${run_id}.full.log" 2>&1
```

`PG_BACKUP_SHA256` is required: take the digest from the B03 handoff
(W0-close.a manifest). Without it the target refuses to run; with it the
restored bytes are compared fail-closed and the receipt records
`sha256_checked:true`.

Keep only the manifest block as the receipt and delete the full log (it may
carry pod output; receipts hold no private data and live outside the repo):

```bash
sed -n '/MANIFEST-BEGIN/,/MANIFEST-END/p' \
  "${receipt_dir}/${run_id}.full.log" \
  > "${receipt_dir}/${run_id}.md"
rm -f "${receipt_dir}/${run_id}.full.log"
```

With `RESTORE_KEEP_DB=true` the restored DB stays available for the authority
checks below; drop it afterwards with one `DROP DATABASE` from the tenant, or
rerun with the default `false`. Lane A indexes the receipt paths and hashes
into `#702`; no Lane B edit under `docs/baselines/app-cm-w0/**`.

### Authority checks (W0-close.c, against the kept DB)

- Reconnect with the restore role and confirm the current authorization
  state is preserved (grants hold, revoked readers still deny).
- Confirm row counts match the manifest (`organizations` plus the B02
  journal/frontier counts from the baseline).
- Confirm no production or preprod object was written (source bucket holds
  only the read object; nothing was written outside the restore namespace).
- Record the recovery duration in the receipt.

### Rotation

- Scoped credentials: maximum 30-day lifetime, immediate revocation after the
  rehearsal, plus incident rotation on any suspected exposure.

## 4. Guard reference

| Guard | Rejected value | Stage |
| --- | --- | --- |
| `PG_BACKUP_KEY` empty | unset | before any write |
| `PG_BACKUP_KEY` shape | not `pg/<ts>.sql.gz`, `..`, sub-paths, JSON injection | before any write |
| `PG_BACKUP_SHA256` missing or malformed | unset or not 64-char hex; mismatch aborts the restore | before any write + in-pod compare |
| `RESTORE_KUBECONFIG` missing | unset | before any write |
| `RESTORE_KUBECONFIG` not isolated | not an absolute path, not a file, `$HOME/.kube/poc.yaml` | before any write |
| Identity capability | `auth can-i create pods` in the restore namespace must be `yes`; negative `auth can-i create pods\|get secrets` in `sentropic` and `sentropic-preprod` (literals plus overrides) answers `yes` | read-only checks |
| `RESTORE_NAMESPACE` | empty, `default`, `sentropic`, `sentropic-preprod`, not `sentropic-restore-*` | before any write |
| `RESTORE_PGHOST` | empty, live hosts, dotted or hex IP literals, illegal chars, FQDN outside the restore namespace | before any write |
| `RESTORE_PGDB` | empty, `app`, `postgres`, `template0`, `template1`, missing `_restore` suffix | before any write |
| Backup credential | unreadable secret or empty/invalid `S3_BUCKET` | read-only check |
| Verification queries | any `psql` failure aborts (`ON_ERROR_STOP`, `pipefail`, `gzip -t`) | strict, nothing swallowed |

## 5. Local verification (no cluster)

```bash
bash scripts/test-pgbackup-restore-isolation.sh
```

The script drives the target with a fake `kubectl` shim: every guard case
must fail with an empty kubectl call log (proving no write precedes the
guard), and the valid isolated case must reach `kubectl run` in the restore
namespace only.
