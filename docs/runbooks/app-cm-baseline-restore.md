# App CM baseline restore (isolated) — W0-close.b runbook

Lot W0-close.b of `plan-v2.md`. This runbook documents the ISOLATED restore
mechanism (`make k8s-pgbackup-restore`) and its B03 manifest. Execution against
a real cluster is W0-close.c, performed by the tenant — not by this lot.

## 1. What the target does

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
| Backup-object read-only credential | secret `sentropic-pgbackup` (`S3_*` keys) | |
| Scratch bucket (optional) | `sentropic-app-cm-restore` | |
| Dedicated namespace kubeconfig | path on the tenant machine | |
| NetworkPolicy/RBAC denying prod/preprod DB writes | applied | |

Credentials live in the tenant's ignored `.env`-style files and are referenced
by name only; they are never printed and never stored in receipts.

## 3. Exact tenant command (W0-close.c)

Run from the repo root, with the confirmed values exported as make variables
(the example uses the proposed defaults plus the tenant's kubeconfig path):

```sh
run_id="restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "docs/runbooks/app-cm-baseline-restore/receipts"
make k8s-pgbackup-restore \
  PG_BACKUP_KEY=pg/<timestamp>.sql.gz \
  KUBECONFIG=<path-to-restore-namespace-kubeconfig> \
  RESTORE_KEEP_DB=true \
  ENV=test-app-w0-restore 2>&1 | tee "docs/runbooks/app-cm-baseline-restore/receipts/${run_id}.log"
```

Then extract the manifest block into the receipt and verify it:

```sh
sed -n '/MANIFEST-BEGIN/,/MANIFEST-END/p' \
  "docs/runbooks/app-cm-baseline-restore/receipts/${run_id}.log" \
  > "docs/runbooks/app-cm-baseline-restore/receipts/${run_id}.md"
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
  only the read object; scratch bucket holds nothing unexpected).
- Record the recovery duration in the receipt.

### Rotation

- Scoped credentials: maximum 30-day lifetime, immediate revocation after the
  rehearsal, plus incident rotation on any suspected exposure.

## 4. Guard reference

| Guard | Rejected value | Stage |
| --- | --- | --- |
| `PG_BACKUP_KEY` empty | unset | before any write |
| `PG_BACKUP_KEY` shape | not `pg/*.sql.gz`, `..`, sub-paths | before any write |
| `KUBECONFIG` absent | unset or not a file | before any write |
| Identity capability | `auth can-i create pods` is not `yes` | read-only check |
| `RESTORE_NAMESPACE` | empty, `sentropic`, `sentropic-preprod` | before any write |
| `RESTORE_PGHOST` | empty, `postgres`, `postgres.sentropic*`, `postgres.sentropic-preprod*` | before any write |
| `RESTORE_PGDB` | empty, `app`, `postgres`, `template0`, `template1` | before any write |
| `RESTORE_SCRATCH_BUCKET` | `s3://` form, slashes, equal to source bucket | before any write |
| Backup credential | unreadable secret or empty `S3_BUCKET` | read-only check |
| In-pod re-check | scratch equal to source or live bucket | before restore write |
| Verification queries | any `psql`/`s5cmd` failure aborts | strict, nothing swallowed |

## 5. Local verification (no cluster)

```sh
sh scripts/test-pgbackup-restore-isolation.sh
```

The script drives the target with a fake `kubectl` shim: every guard case
must fail with an empty kubectl call log (proving no write precedes the
guard), and the valid isolated case must reach `kubectl run` in the restore
namespace only.
