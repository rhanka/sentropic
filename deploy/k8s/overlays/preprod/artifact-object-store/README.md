# Preprod artifact object store (`artifact-object-store`)

PREPROD ONLY (`sentropic-preprod`). Namespace-local S3-compatible store (RustFS 1.0.4,
digest-pinned, uid 10001, read-only root filesystem, 5Gi `block-standard` PVC) behind
Service `artifact-object-store:9000`. Only `artifact-content` and `api` pods reach it;
it has no egress.

## Why RustFS, not MinIO
`createPrivateArtifactStorage` (api/src/services/artifacts/lifecycle.ts) calls
`GetPublicAccessBlock` at startup and before every blob operation and requires all four
`Block*` fields true. MinIO answers `501 NotImplemented` (probe 2026-11-08), Scaleway
fr-par `405`. RustFS stores the configuration per bucket and refuses a public bucket
policy while `BlockPublicPolicy` is set.

## Buckets and principals
| Bucket | Principal (IAM policy) | Consumer | Secret keys |
|---|---|---|---|
| `artifacts` | `iam/artifact-content-read.json` | artifact-content | `artifact-content-runtime`: `APP_ARTIFACT_S3_*` |
| `artifact-builder-cache` | `iam/artifact-builder-cache-rw.json` | api builder cache | `sentropic-api`: `ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID`, `ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY` |

Both buckets carry `public-access-block.xml` (4 x true). The root pair lives only in
Secret `artifact-object-store` (`RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, required).
`.env` recovery copies (0600, names only): `PREPROD_ARTIFACT_OBJECT_STORE_ROOT_*`,
`PREPROD_ARTIFACT_CONTENT_S3_*`, `PREPROD_ARTIFACT_BUILDER_CACHE_S3_*`,
`PREPROD_ARTIFACT_CONTENT_DB_PASSWORD`, `PREPROD_ARTIFACT_CONTENT_SIGNING_KEY`.

## Bootstrap and rotation (operator)
1. Mint values into `.env` first, then the Secrets (merge patch of one key, read-back by
   fingerprint). Never print a value.
2. Buckets and `PutPublicAccessBlock`: SigV4-signed requests with the root pair through
   `kubectl port-forward pod/artifact-object-store-0` (port-forward does not widen the
   NetworkPolicy).
3. IAM users/policies: a short-lived `mc` pod (Chainguard minio-client, digest-pinned)
   admitted by a temporary NetworkPolicy; pod, policy and Secret are deleted afterwards.
4. Qualification before any wiring: signed `GetPublicAccessBlock` with each consumer
   credential (4 x true), anonymous reads 403, cross-bucket access 403, consumer cannot
   change the block, public bucket policy refused. Record the receipt with its sha256.
5. Rotation: same steps with new values; restart `artifact-content` / `api` after the
   Secret change. Cycle: 90 days maximum, or at once on exposure.

## Database role `artifact_content`
`artifact-content-db-role.sql` is idempotent. Feed `\set pw '<48 hex>'` and the file on
psql STDIN inside `postgres-0` (`psql -U "$POSTGRES_USER" -d app -v ON_ERROR_STOP=1`);
`DATABASE_URL` in `artifact-content-runtime` is
`postgres://artifact_content:<pw>@postgres:5432/app`. The activation consume grants are
an open architecture item (see the SQL header).

## Rollback
Remove `artifact-object-store` from `../kustomization.yaml`, delete the StatefulSet, PVC
`data-artifact-object-store-0`, Service, NetworkPolicy and Secret `artifact-object-store`.
Content serving must be closed first (it refuses startup without its store).
