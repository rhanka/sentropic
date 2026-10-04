# IdP identity sync — credential cycle

Secret values belong in protected GitHub environments, ignored 0600 `.env`
recovery files and namespace-scoped Kubernetes Secrets. This record contains
identity IDs, names, scopes and dates only. Do not commit values, kubeconfigs,
plaintext Secret manifests or CSV snapshots.

## Delegations and expiry

| Identity / SA | Namespace | Delegated operations | GitHub secret / material | Expiry and owner |
| --- | --- | --- | --- | --- |
| `sentropic-ci-idp-bundle-prod` | `sentropic` | Two Secrets get/update by name; bundle ConfigMaps/SAs/NP/CronJob/trigger RBAC create + scoped get/patch/update; Jobs create/get/list/watch/delete; pods and pods/log get/list; impersonate trigger SA | `KUBE_CONFIG_DATA_IDP_BUNDLE_PROD` in `sentropic-idp-prod` | Tenant admin TokenRequest ≤90 days; record actual server-issued expiry before arming |
| `sentropic-ci-trigger-idp-export` | `sentropic` | Exact export CronJob get/patch, VAP restricts changes to suspend; Jobs get/list/watch; pods get/list; **no pods/log**, Job create or Secret access | `KUBE_CONFIG_DATA_IDP_TRIGGER_PROD` in `sentropic-idp-run` | Tenant admin TokenRequest ≤90 days; record actual expiry |
| Existing preprod CI SA (record actual identity at bootstrap) | `sentropic-preprod` | Existing tenant deployment rights, import Jobs create/delete/apply/get/list/watch, pods/status/logs read | `KUBE_CONFIG_DATA_PREPROD` in `sentropic-idp-run` | Existing credential register; verify expiry and renew before arming |
| `sentropic-idp-export` pod SA | `sentropic` | No API token mounted; PostgreSQL connection using reader Secret; relay writer via env | `sentropic-idp-identity-reader`, `sentropic-idp-relay-writer` | Pod SA has no issued workflow token; material rotates every 90 days |
| `sentropic-idp-sync` pod SA | `sentropic-preprod` | No API token mounted; preprod app DB, preprod rollback bucket, relay read only | `sentropic-postgres`, `sentropic-pgbackup`, `sentropic-idp-relay-reader` | Tenant governs existing DB/backup material; relay rotation 90 days |
| `idp_identity_reader` PG role | Prod app DB | LOGIN, read-only, connection limit 2, statement timeout 60 s, exact column SELECT (users 13, WebAuthn 10) | `sentropic-idp-identity-reader` keys PGUSER/PGPASSWORD | Tenant-generated password; record issuance and rotate ≤90 days |

The bundle identity is privileged within the tenant: Kubernetes create permissions
cannot be restricted by resource name. Its existing-resource and Secret updates
are bounded by the bootstrap Role. Keep it in the owner-reviewed prod environment.
The narrow trigger's jobTemplate restriction depends on the k8s-owned Deny VAP;
CD tests that admission is enforced and neutralizes its Role on gate failure.

TokenRequest kubeconfigs use bounded tokens, not legacy ServiceAccount token
Secrets. Keep a 0600 recovery kubeconfig outside git and record its SA UID and
actual token expiry in the tenant credential register. Issue replacements before
expiry and update the matching GitHub environment secret. To revoke all tokens,
the tenant admin deletes/recreates the SA (new UID); removing the RoleBinding
cuts authorization immediately. Re-run the protected preflight and admission gate
after restoring delegation. Never prolong a token past the 90-day ceiling.

## Four locations and reconciliation

Locations are (1) central `/home/antoinefa/src/sentropic/.env`, (2) tenant `.env`,
(3) GitHub Environment and (4) Kubernetes Secret. Central and tenant refer to the
**same** sentropic file in this repository; there is no second independent copy.
Use the same variable names for recovery material. Reader S3 material is
tenant-deposited rather than read by this workflow, so it has no required GitHub
copy; the workflow does not reconcile it.

| Identity | OVH user id | Central / tenant `.env` variables | GH Environment secrets | k8s Secret / namespace | Rewritten by | Rotation due |
| --- | --- | --- | --- | --- | --- | --- |
| Relay writer `user-sSSdQkbNnDxM` | 827478 | `SENTROPIC_IDP_RELAY_WRITER_S3_ACCESS_KEY`, `SENTROPIC_IDP_RELAY_WRITER_S3_SECRET_KEY` | Same names, `sentropic-idp-prod` | `sentropic-idp-relay-writer` / `sentropic` | Bundle CD: both server dry-runs before replacements | 2027-01-01 (minted 2026-10-03, 90 days) |
| Relay reader `user-4W6sWxBEsS3W` | 827480 | `SENTROPIC_IDP_RELAY_READER_S3_ACCESS_KEY`, `SENTROPIC_IDP_RELAY_READER_S3_SECRET_KEY` | N/A: no GH consumer; tenant-deposited from recovery storage | `sentropic-idp-relay-reader` / `sentropic-preprod` | Tenant admin governed deposit | 2027-01-01 (minted 2026-10-03, 90 days) |
| Prod PG reader `idp_identity_reader` | N/A | `SENTROPIC_IDP_IDENTITY_READER_PG_PASSWORD` | Same name, `sentropic-idp-prod` | `sentropic-idp-identity-reader` / `sentropic` | Bundle CD + reader-role provision Job (`ALTER ROLE ... PASSWORD`) | Record actual mint date; +90 days maximum |
| Bundle/trigger TokenRequest kubeconfigs | N/A | Tenant registry records kubeconfig path and token expiry; ignored 0600 files | `KUBE_CONFIG_DATA_IDP_BUNDLE_PROD` / `sentropic-idp-prod`; `KUBE_CONFIG_DATA_IDP_TRIGGER_PROD` / `sentropic-idp-run` | N/A: no token Secret | Tenant admin → environment deposit | Actual server expiry, ≤90 days |
| Existing preprod CI, DB and backup credentials | Existing tenant register | Existing tenant recovery variables | `KUBE_CONFIG_DATA_PREPROD` / `sentropic-idp-run`; DB/backup values are not consumed by this workflow | Preprod `sentropic-postgres`, `sentropic-pgbackup` | Existing tenant credential pipeline | Follow existing register; verify before real sync |

All relay Secrets use `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_ENDPOINT`,
`S3_REGION`. Governed target is `sentropic-idp-identity-relay`, endpoint
`https://s3.bhs.io.cloud.ovh.net`, region `bhs`. Corresponding GH variables are
`SENTROPIC_IDP_RELAY_S3_BUCKET`, `SENTROPIC_IDP_RELAY_S3_ENDPOINT`,
`SENTROPIC_IDP_RELAY_S3_REGION`. The PG Secret uses `PGUSER=idp_identity_reader`
and `PGPASSWORD`; the provision Job reads it as `RO_PASSWORD` via psql `\getenv`.

Writer scope: Put/Get/AbortMPU/ListParts on `idp-identity/*`, plus ListBucket,
GetBucketLocation and ListMPU; no delete. Reader scope: GetObject on that prefix,
ListBucket/GetBucketLocation; no write/delete. Bucket owner 827476 has no S3 keys.
Source: poc-k8s `docs/runbooks/preprod-cred-governance.md`, IdP relay entry dated
2026-10-03. Neither bucket ownership nor lifecycle can be changed by these keys.

## Rotation and verification

Rotate every 90 days, or immediately on suspected exposure, one identity at a time.

1. The k8s lane mints a new S3 credential for the same OVH user/policy with
   `POST /cloud/project/{P}/user/{id}/s3Credentials`; keep the old key valid.
2. Update central/tenant recovery and the correct GH environment without printing
   values. Bundle CD propagates the writer; the tenant deposits the reader.
   Confirm each key's least-privilege policy and unchanged bucket/prefix.
3. Run protected bundle CD and a main dry-run import; confirm export upload,
   reader fetch, rollback dump upload and `outcome=rolled_back` audit all pass.
4. Only then revoke the previous S3 credential with DELETE and record verification,
   rotation date and the next +90-day due date. User and policy survive rotation.

For the PG reader, generate fresh material into protected storage, update the
recovery file and `sentropic-idp-prod` secret, then run bundle CD. Updating a Secret
alone does not change PostgreSQL's live password: the reader Job performs the
idempotent ALTER. Do not trigger exports during this transition; confirm provision
completion and a fresh protected dry-run export/import before recording success.

Preprod reader rotation cannot be accomplished by bundle CD: it intentionally has
no preprod credential access. Existing preprod DB/backup credentials remain under
their own rotation process; confirm that process also updates the live DB role.
Retirement requires disabling schedule/CD, removing delegations and tenant Secrets,
then revoking relay credentials under k8s governance. Do not delete the shared
preprod backup identity as part of retiring this sync feature.
