# Sentropic production backup reader credential cycle

Operator and tenant: **sentropic**. Purpose: production PostgreSQL backup recovery.
The tenant operates under the owner's backup rule; rotation is documented in the
root `.env`, which is ignored by Git and must retain mode `0600`.

## Production storage

The production `pgbackup` CronJob's destination was verified read-only with the
sentropic tenant kubeconfig on **2026-10-29**:

| Provider | Endpoint | Region | Bucket |
| --- | --- | --- | --- |
| OVH | `https://s3.bhs.io.cloud.ovh.net` | `bhs` | `sentropic-pgbackup` |

## Wrong-provider reader revoked (2026-10-29)

The Scaleway IAM application and policy `sentropic-backup-reader` and its API key
were created on **2026-10-29** against a different, same-named Scaleway bucket.
They targeted the wrong provider, never provided usable reading (LIST returned
HTTP 403 AccessDenied), and were unused. They were revoked on **2026-10-29**:

| Deleted object | Name / identifier |
| --- | --- |
| API key | `sentropic-backup-reader cycle 2026-10-29; rotate before 2027-01-27`, attached to the application below |
| IAM policy | `sentropic-backup-reader`, ID `8044506a-7d71-4734-8ecb-5b55b027250e` |
| IAM application | `sentropic-backup-reader`, ID `08a0219c-22ff-4e0f-ade8-b53c314dff4b` |

Each object's name, ID and application association were verified before deletion;
absence was verified afterwards. The four `SENTROPIC_BACKUP_READER_S3_*` entries
(`USER`, `USERID`, `ACCESS_KEY`, `SECRET_KEY`) were removed from the root `.env`.
All other bytes and mode `0600` were preserved. No OVH reader was created.

## Local restore evidence

On **2026-10-29**, per owner decision, the app isolated restore **W0-close.c was
completed** from a live production `pg_dump` obtained via `make db-backup-prod`
using the tenant kubeconfig from `.env`, **not from the S3 backup object**.
The [restore receipt in PR #702](https://github.com/rhanka/sentropic/blob/4ecfd73f3fea9dafd5024321b576be43531eb6f9/docs/runbooks/app-cm-baseline-restore/receipts/restore-local-20261029T084403Z.md)
records the local restore and its proof limits. The Scaleway reader was not on
that restore path; this restore does not validate S3 backup recovery.
The Kubernetes request for W0-close.c was withdrawn; no request is pending.

## Future reader: owner rule, scope and rotation

Any future reader must be an **OVH S3 credential**, scoped read-only to
`sentropic-pgbackup` on **BHS**, minted under the owner's backup rule. The sentropic
tenant operates it and documents rotation in `.env`. Do not create a credential
as part of this correction. Do not reuse Scaleway IAM provisioning instructions.

Required: ListBucket, ListBucketVersions, GetObject,
GetObjectVersion and HEAD metadata. No write, delete, or administration.
Prefer prefix restriction to `pg/*`; bucket-wide reading is owner-authorized if
prefix scope is unavailable. Other buckets must remain inaccessible.
Never replace a bucket policy without first reading and preserving existing rules.
No GitHub secret, cluster secret, or other tenant copy is needed for local recovery.

Cycle: **90 days**, immediately on suspected exposure. For a future OVH reader:

1. Verify the OVH tenant, BHS endpoint and bucket before minting under the owner's
   rule; preserve existing production access and use OVH-supported scoping.
2. Store credentials only in the protected root `.env`, through an operator make
   target under `umask 077`, without echoing values or enabling shell tracing.
   Record creation, scope, expiry, rotation date and verification receipt in `.env`.
3. Keep the old key during verification. Atomically replace the key variables
   in `.env`; preserve mode `0600`.
4. Verify positive reading, denied PUT, and an isolated local restore with the new
   key. Record date, next expiry, policy scope, object version/hash and receipt path.
5. Only after success, revoke the old OVH key through a quiet operator target.
6. Emergency revocation: revoke the affected OVH key immediately, remove the local
   key entries, then provision and verify a replacement before resuming recovery.

## Verification (operator make target; never print credentials)

Use the future dedicated reader with endpoint `https://s3.bhs.io.cloud.ovh.net`,
region `bhs`, and bucket `sentropic-pgbackup`. Never use an operator key to read a dump.
Require successful list/versioned read and HEAD metadata, then exactly
`403 AccessDenied` for PUT. Authentication errors or a failed LIST do not prove a
usable reader. If PUT succeeds, stop and report the authorization failure; do not
use a privileged identity to erase evidence. Verify denied access outside the
declared scope, inspect effective permissions for delete/admin denial, and retain
only non-secret verification facts. Local restore uses `ENV=test-app-w0c`, never
`dev`, and follows the owner packet; delete the dump and stop its stack afterwards.
