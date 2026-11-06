# Preprod A4 cutover — owner review and execution

This is option B of the 2026-11-06 API incident. Building this procedure does not authorize executing it. The owner approves the concrete candidate, fence, rollback limits and evidence before any Kubernetes change. Main deployment remains frozen until that approval and the completed cutover. This wagon has no PR and joins the next dated train; integration owns its final independent review and CI. G7 stays suspended and dry-run throughout this procedure.

## Operator inputs and custody

Use a protected tenant kubeconfig file supplied through the existing credential custodian (`K8S_TENANT_ADMIN_KUBECONFIG_B64` in the central ignored `.env`, by name only). `A4_KUBECONFIG_FILE` is an existing absolute 0600 file, not a credential value. Never enable shell tracing or forward raw kubectl, database, S3, or application errors. All targets below print digests only. Their failure digests indicate refusal; retain private evidence and inspect it inside tenant custody.

The operator creates an absolute 0600 `A4_REQUEST_FILE` with these exact fields. Resolve every reference to an existing approved record; no placeholder, generic CI receipt, or guessed qualification is accepted. `candidateCommit` is the full 40-character train candidate SHA; `candidateImage` is its matching immutable `rg.fr-par.scw.cloud/nc-reg/sentropic-api@sha256:…` release image. Keep their release provenance with the authorization.

| Field | Required content |
| --- | --- |
| `format`, `namespace`, `operationId` | `preprod-a4-request/1`, `sentropic-preprod`, a unique lowercase operation name (at most 40 characters) |
| `candidateCommit`, `candidateImage` | Exact reviewed train candidate and matching image digest; no zero SHA or tag |
| `backupTemplateSha256` | Digest returned by the read-only `inspect` invocation below, ratified by the tenant backup operator |
| `authorizationRef`, `writerFenceRef` | Recorded owner execution approval and enumerated SQL/file-writer fence evidence |
| `rollbackCheckpointRef`, `rollbackLimitsRef` | Named recovery point and approved whole-database restoration limits, key availability and post-cutover write disposition |
| `sourceMetadataDispositionRef` | Approved retention/access/deletion rules for the full SQL dump and remote snapshot |
| `remoteSnapshotRef`, `remoteSnapshotDigest` | Actual protected remote-session exporter receipt and SHA-256 of its exact UTF-8 JSON bytes |
| `legacyWritersStopped`, `remoteFileWriterStopped` | Literal `true`, backed by the real fence; never predictions |

`A4_REMOTE_FILE` is the actual 0600 remote snapshot, using `remote-session-projection-snapshot/1`. Do not synthesize an empty snapshot. If the real export is empty, its exporter receipt must establish that census. The supplied bytes are checked by the shipped parser and reconciled with SQL sessions. The source snapshot is a full tenant `pg_dump` gzip, preserving historical metadata for D11; no identity row or receipt payload is printed.

`A4_BUDGETS_FILE` is the tenant-qualified 0600 JSON, with its actual `qualificationReceiptRef` and exactly `reservation`, `deletion`, `diagnostic`, `read`, `workspace`, `replicaExport`, `replicaValidation`, `replicaSync`. Each entry has exactly `deadlineMs` (integer 1–600000) and `maxAttempts` (1–3). Obtain values from qualification; the repo supplies no invented budgets.

## Kubernetes objects: tenant creates versus repository carries

| Object / material | Tenant Kubernetes action | Repository content |
| --- | --- | --- |
| Existing `email-code-hmac` Secret | Verify ACTIVE key and ref exist; PREVIOUS pair is absent for this initial ring. Do not change the key or bypass its single-writer admission policy. | Explicit Secret refs; runtime conversion from hex to canonical 43-character base64url; keyed fingerprint check against `email-code-hmac:v1:preprod:15c2f8b66073655a` |
| `sentropic-identity-budgets` Secret | Create Opaque Secret with key `CM_IDENTITY_DELETION_BUDGETS_JSON` from the qualified private file. Existing Secret requires tenant review rather than overwrite. | API nonoptional secretKeyRef; existing G7 references remain; validation of all eight qualified budgets |
| Existing `sentropic-postgres`, `sentropic-api`, `sentropic-pgbackup`, `sentropic-app` | Verify existing tenant identities and backup bucket; grant no new cluster-wide backup identity. | Existing DB/backup path and service account references; no secret values |
| PVC `sentropic-a4-custody` | Create 20Gi `block-standard`, ReadWriteOnce; ensure tenant-approved encrypted storage, access restrictions, capacity and retention. Retain it across Pod deletion and rollback. | Separate `custody-pvc.yaml`; no automatic evidence deletion |
| ConfigMap `sentropic-a4-runtime` | Apply generated launcher/staging code. It contains code only. | `a4-runtime/{kustomization.yaml,launch.mjs,stage.mjs}` |
| Pod `sentropic-a4-custodian` | Create one temporary Pod at the exact candidate image; no service-account token; PG-backup network label; existing API env plus tenant backup Secret. | Node manifest builder; migration-free idle command; root UID/GID matches protected owner-only files |
| API volumes `cm-cutover`, `cm-runtime` | Add PVC and ConfigMap mounts, both read-only on API; PVC read-write only in custodian. Do not set `fsGroup`, which widens file permissions. | `patch-api-a4.yaml`; no checkpoint/snapshot Secret or ConfigMap |
| Protected PVC files | Stage `request.json`, actual `remote.json`; generate `source.sql.gz`, `snapshot.json`; stage tenant `rehearsal.json`; generate `checkpoint.json`. Directory 0700, regular files 0600, UID 0, no symlinks. | Schemas, validators and exclusive creation only; no live file or dataset committed |
| ConfigMap `api` / Deployment `api` | Patch while scaled to zero; pin candidate image. Restore one replica only after checkpoint review. | Checkpoint path `/run/cm-cutover/checkpoint.json`; HMAC policy `hmac-sha256`; approval `qk-secret-custody-r2:Q-K=A:2026-11-02`; pinned active keyRef |
| Job `pgbackup-a4-<operationId>` | Create once from the exact ratified tenant `pgbackup` Job template and wait for completion. Retain its evidence. | Template digest check, exact clone, readback using the existing backup Secret; no replacement backup service |

The HMAC approval is the existing Q-K=A decision and custody method documented in [the credential-cycle runbook](email-code-hmac-cred-cycle.md). The launcher composes `CM_IDENTITY_EMAIL_CODE_KEYS_JSON` only in process memory, removes the raw legacy HMAC variables from the child environment, and supplies previous refs `[]`. No new HMAC Secret, JSON credential file, key rotation, or credential argv is created. Rotation remains a separate custody operation.

## Ordered execution after owner authorization

Use the reviewed train checkout. Set only absolute private-file paths in the target arguments; `ENV=test-preprod-a4` is last. These operator targets contact the explicitly supplied preprod kubeconfig; the ENV name isolates local tooling and is not a deployment selector. `A4_DRY_RUN=1` is the default and never creates resources or files.

1. Record the full candidate/image provenance and chosen functional sign-in flow. Obtain owner authorization for the bounded fence and tenant snapshot/rehearsal operations. Stop continuous deployments/GitOps reconciliation and exclude manual writers for the whole fence window; record original replica counts and CronJob states privately.
2. Quiesce **all Deployments** in `sentropic-preprod`, including API, auth-idp, UI and workers; quiesce every non-Postgres StatefulSet. The fence requires no DaemonSet in this namespace; abort for tenant review if one exists. Suspend all CronJobs, including `pgbackup` and G7; wait for running Jobs to finish or cancel them under the approved fence. Wait until old/terminating writer Pods disappear. PostgreSQL stays available. Stop the actual remote-file writer outside this namespace too; preserve its export and fence receipt. Enforce PostgreSQL access exclusion for external/manual writers through tenant controls. Scaling workloads alone does not fence such writers.
3. Inspect the tenant backup template, review its digest with the backup operator, and finalize the request:

   `make k8s-preprod-a4-prepare A4_PHASE=inspect A4_KUBECONFIG_FILE=/private/tenant-kubeconfig ENV=test-preprod-a4`

4. Validate and create the qualified budgets Secret with `make k8s-preprod-a4-custody A4_OPERATION=budgets A4_DRY_RUN=0 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json A4_BUDGETS_FILE=/private/budgets.json ENV=test-preprod-a4`. Run it first with `A4_DRY_RUN=1`. No existing Secret is overwritten.
5. Stage only the required overlay changes while API replicas and observed replicas are zero:

   `make k8s-preprod-a4-custody A4_OPERATION=wire A4_DRY_RUN=0 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-preprod-a4`

   First use `A4_DRY_RUN=1`. This creates the PVC/runtime ConfigMap and patches API config/deployment/image without changing replica counts. Do not invoke the general preprod deployment target during the fence: applying the whole overlay can reset replicas and release image pins.
6. Create the migration-free custodian with the same command using `A4_OPERATION=custodian`; then stage inputs using `A4_OPERATION=stage A4_STAGE=inputs A4_REMOTE_FILE=/private/remote.json`. Run each with dry-run first, then explicit `A4_DRY_RUN=0`. Staging is exclusive and never overwrites files.
7. Run snapshot preflight, then take the tenant backup:

   `make k8s-preprod-a4-prepare A4_PHASE=snapshot A4_DRY_RUN=0 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-preprod-a4`

   First use `A4_DRY_RUN=1`. The real invocation checks the fence, reads journals/schema/source in a read-only transaction, clones the approved CronJob template, waits, downloads the resulting `pg/<timestamp>.sql.gz` through the tenant backup identity, validates length/gzip/pg_dump envelope, and saves a private 0600 copy. It rechecks source/schema/journals before writing `snapshot.json`. No checkpoint or application migration is written at this stage. A snapshot preflight cannot validate a future backup; full checkpoint dry-run below validates all existing artifacts.
8. **Rollback point established, before any legacy-table deletion:** tenant backup operator restores that exact gzip into its sanctioned isolated restore placement, verifies its full SHA-256 and schema, then boots this exact candidate with its real mapping/verifier and the captured source/remote shape. Use an isolated `purpose: rehearsal` checkpoint, not the live cutover checkpoint. Verify import/D11/readiness and the chosen functional auth flow there. Do not infer this receipt from CI or G7 dry-run. Do not use the production-to-preprod seed target as rollback.
9. The tenant writes private `rehearsal.json` with exactly `format: preprod-a4-rehearsal/1`, existing `receiptRef`, `evidenceSha256` equal to the exact `snapshot.json` byte digest, `restoredBackupSha256` equal to `backupSha256`, `candidateBootPassed: true`, `functionalAuthPassed: true`, `d11Passed: true`, and the existing `isolatedRestoreRef`. Stage it with the custody target: `A4_OPERATION=stage A4_STAGE=rehearsal A4_REHEARSAL_FILE=/private/rehearsal.json`, dry-run then explicit write. Its private custody is the attestation trust boundary; a reference string is not an independent signature verifier.
10. Validate **all** existing checkpoint inputs without writing:

    `make k8s-preprod-a4-prepare A4_PHASE=checkpoint A4_DRY_RUN=1 A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-preprod-a4`

    It rechecks live SQL source/schema/journals, remote bytes, image, keys/budgets, both local and object-store backup bytes, exact rehearsal binding, and the real shipped checkpoint schema. Any change requires fresh evidence/rehearsal; no accepted digest is rebased in place.
11. With the approved fence still held, repeat with `A4_DRY_RUN=0`. It exclusively writes the real `app-cm-identity-cutover/1`, `purpose: cutover` checkpoint, enforces 0600 and at most 32768 bytes, and reloads it with the boot validator. Review the returned digests against the private receipts before boot. Delete only the temporary custodian Pod so the ReadWriteOnce PVC detaches; keep the PVC/files. Preserve the approved tenant single-writer exclusion.
12. The tenant operator scales **only API** to one replica at the already pinned candidate image, then waits for rollout. API boot owns the import/deletion transaction. Do not resume auth-idp, other writers, CronJobs, remote-file writers or automatic deployment yet.

## Verification and release of the fence

Run `make k8s-preprod-a4-verify A4_KUBECONFIG_FILE=/private/tenant-kubeconfig A4_REQUEST_FILE=/private/request.json ENV=test-preprod-a4`. It uses a read-only transaction to require journal timestamp **1793577600000** with the bundled migration hash; CM receipt `0015_app_cm_identity_cutover` with preserved-material/identity/lifecycle attestations and matching source/manifest digest; D11 `a4-identity-cutover` / `pre-deletion-checkpoint` matching candidate, source, remote, mapping and rehearsal; D11 `a4-identity-cutover-completed` / `post-deletion-attestation` with `legacy_tables_dropped=true`; and absence of `public.users`. It also requires updated/available API replicas, a serving EndpointSlice and public API health **HTTP 200**. It prints digests, never receipt JSON.

Check startup completed and no migration error through tenant-controlled log inspection; do not publish raw errors or log tails. Restore the reviewed coherent auth-idp/UI release and perform the nominated authorized functional flow: obtain a fresh email code or magic link, complete sign-in, satisfy required MFA, access the expected account/workspace, exercise the approved refresh/revocation check, then sign out. Old ephemeral challenges/codes/links and legacy sessions are intentionally invalidated by the owner’s prior cutover policy; request fresh credentials rather than treating replay refusal as auth success. Record functional evidence without codes/tokens, user rows or secret values. HTTP health, UI shell, and IdP process health alone do not satisfy this gate.

Release writers only after DB/D11/readiness/HTTP and functional receipts all pass. Restore approved controller counts individually and reinstate the nightly backup schedule; restore remote writers only under the reviewed CM-compatible path. Keep G7 suspended with both dry-run legs set: account retirement and G7 activation need their separate authorization and runner reconciliation. Retain rollback evidence under its approved metadata-disposition policy.

## Abort and rollback

On any missing receipt, drift, changed template, unexpected writer, corrupt snapshot, invalid key/budget, permission failure, failed rehearsal, timeout, migration error or failed auth verification: stop, keep the fence and deployment freeze, preserve private evidence, and do not issue/consume a new checkpoint or resume writers. There is no automatic rollback, retry with relaxed validation, or migration/journal editing.

Before import commits, the control import/deletion transaction rolls back on failure. Public migrations and settings reconciliation run earlier and may already have committed: a failed boot does not prove an unchanged database. Read journal/schema state and prove compatibility before restoring any prior image. An incomplete preparation leaves no valid checkpoint; do not overwrite its files or reuse its operation ID.

After journal/D11 show a committed cutover, an old-image rollback alone is incompatible. The tenant backup operator performs the explicitly approved whole-database restore from the validated `source.sql.gz`/tenant object and restores the agreed remote snapshot and coherent prior release, with writers still stopped. Apply the established OAuth refresh invalidation on restore, preserve HMAC/signing/connector key custody, then verify journal/schema, readiness, HTTP 200 and functional authentication again. The approved limits must state treatment of every write accepted since the snapshot. If that loss is not authorized, remain fenced and obtain the owner’s recovery decision; do not discard those writes.
