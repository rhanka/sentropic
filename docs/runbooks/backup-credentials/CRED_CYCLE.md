# Sentropic production backup reader credential cycle

Operator and tenant: **sentropic**. Purpose: production PostgreSQL backup recovery.
Owner approved creation on 2026-10-29. Model: the immo
`deploy/ci/bascule-preprod/CRED_CYCLE.md` 90-day cycle;
immo credentials and resources are never used for sentropic recovery.

## Current state — BLOCKED (2026-10-29)

Application and IAM policy: `sentropic-backup-reader`. An expiring API key was
minted with the configured `scw` CLI and written directly to the root `.env`.
The policy has only `ObjectStorageReadOnly`, scoped to the configured project,
with condition `resource.name == "sentropic-pgbackup"`. No write/delete/admin set.
This conditional policy is **not a validated bucket-scoping mechanism**.

Real reader LIST of `pg/*.sql.gz` was refused: HTTP 403 AccessDenied. The reader
is not usable until this authorization failure is resolved. The bucket policy is
the likely cause, but the cause is **not verified**: the policy was not read,
because the configured operator key also receives 403 on `GetBucketPolicy`.
Real PUT of the unique probe
`pg/__sentropic-backup-reader-denycheck-20261029T065600Z`: HTTP 403
AccessDenied; no object created. This proves denied writing, not usable reading.

On **2026-10-29**, per owner decision, the app isolated restore **W0-close.c was
completed** from a live production `pg_dump` obtained via `make db-backup-prod`
using the tenant kubeconfig from `.env`, **not from the S3 backup object**.
The [restore receipt in PR #702](https://github.com/rhanka/sentropic/blob/4ecfd73f3fea9dafd5024321b576be43531eb6f9/docs/runbooks/app-cm-baseline-restore/receipts/restore-local-20261029T084403Z.md)
records the local restore and its proof limits. The reader was not on that restore
path and remains unusable; this restore does not validate S3 backup recovery.
The Kubernetes request for W0-close.c was withdrawn; no request is pending.

[Scaleway's integration list](https://www.scaleway.com/en/docs/iam/policies-permissions/supported-products-resource-level/)
does not include Object Storage. Its
[IAM/bucket policy guide](https://www.scaleway.com/en/docs/object-storage/api-cli/combining-iam-and-object-storage/)
requires bucket policies for bucket-level access. The configured operator's
signed `GET /?policy` against `sentropic-pgbackup` returned 403 AccessDenied:
effective `s3:GetBucketPolicy` access is missing. Inspecting and safely updating
the existing policy requires `s3:GetBucketPolicy` and `s3:PutBucketPolicy` on this
bucket (Scaleway permission set `ObjectStorageBucketPolicyFullAccess`, subject to
the existing bucket policy). IAM application/policy/key creation did succeed.

Do not remove the IAM condition to gain project-wide reading. The operator must
resolve bucket-scoped authorization while preserving existing production access
and proving that other buckets remain inaccessible. Prefix restriction to `pg/*`
is preferred; bucket-wide reading is owner-authorized if prefix scope is unavailable.
Never replace a bucket policy without first reading and preserving existing rules.

## Storage and names

Only `/home/antoinefa/src/sentropic/.env`, ignored by Git, mode `0600`:

| Variable | Meaning |
| --- | --- |
| `SENTROPIC_BACKUP_READER_S3_USER` | Application name |
| `SENTROPIC_BACKUP_READER_S3_USERID` | IAM application ID, not a human user |
| `SENTROPIC_BACKUP_READER_S3_ACCESS_KEY` | Dedicated reader access key |
| `SENTROPIC_BACKUP_READER_S3_SECRET_KEY` | Dedicated reader secret key |

Target: `PG_BACKUP_BUCKET=sentropic-pgbackup`, `https://s3.fr-par.scw.cloud`,
region `fr-par`. Required: ListBucket, ListBucketVersions, GetObject,
GetObjectVersion and HEAD metadata. No write, delete, or administration.
No GitHub secret, cluster secret, or other tenant copy is needed for local recovery.

## Rotation and revocation

Cycle: **90 days**, immediately on suspected exposure. Minted 2026-10-29;
rotate **before 2027-01-27 06:57 UTC**, the API key's enforced expiry.

1. With `scw iam application list`, identify the dedicated application; inspect
   its policies using `scw iam policy list` and `scw iam rule list policy-id=...`.
2. Create its replacement with `scw iam api-key create application-id=...`
   and explicit `default-project-id=...`, `expires-at=...`, and cycle description.
   Run through an operator make target; pipe JSON directly into a validated writer
   for `.env`, under `umask 077`, without echoing values or enabling shell tracing.
3. Keep the old key during verification. Atomically replace the two key variables
   in `.env`; preserve the application name/ID and mode `0600`.
4. Verify positive reading, denied PUT, and an isolated local restore with the new
   key. Record date, next expiry, policy scope, object version/hash and receipt path.
5. Only after success, revoke the old key with `scw iam api-key delete` in a quiet
   operator target; read its access key from protected storage, never from logs.
6. Emergency revocation: delete the affected API key immediately, remove the local
   key entries, then provision and verify a replacement before resuming recovery.

## Verification (operator make target; never print credentials)

Load only the four reader variables from the protected `.env` into the target's
shell. Export `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the two reader
key variables, plus `AWS_REGION=fr-par`. Never use the CLI operator key to read a dump.
With `S5='s5cmd --retry-count 0 --endpoint-url https://s3.fr-par.scw.cloud'`:

```sh
$S5 ls --etag 's3://sentropic-pgbackup/pg/*.sql.gz'
$S5 ls --all-versions --etag 's3://sentropic-pgbackup/pg/<chosen>.sql.gz'
$S5 cp --version-id '<chosen-version>' 's3://sentropic-pgbackup/pg/<chosen>.sql.gz' '<ignored-local-file>'
sha256sum '<ignored-local-file>'
printf 'reader-denial-probe' | $S5 pipe 's3://sentropic-pgbackup/pg/__reader-denycheck-<unique-run-id>'
```

Require successful list/versioned read and HEAD metadata, then exactly
`403 AccessDenied` for PUT. Authentication errors or a failed LIST do not prove a
usable reader. If PUT succeeds, stop and report the authorization failure; do not
use a privileged identity to erase evidence. Verify denied access outside the
declared scope, inspect effective permissions for delete/admin denial, and retain
only non-secret verification facts. Local restore uses `ENV=test-app-w0c`, never
`dev`, and follows the owner packet; delete the dump and stop its stack afterwards.
