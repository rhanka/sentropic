-- Offline only: stop every writer/maintenance job and migrate each scope to
-- object with verified read-back before running this through make db-query.
-- Retain all DDL and data; only the six incompatible receipts are retired.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('sentropic:artifact-package-migrations'));
LOCK TABLE artifacts.blobs, artifacts.blob_bytes, artifacts.upload_staging_bytes
  IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM artifacts.blobs WHERE placement <> 'object')
    OR EXISTS (SELECT 1 FROM artifacts.upload_staging_bytes) THEN
    RAISE EXCEPTION 'Rollback requires verified object placement and drained DB staging';
  END IF;
  IF (SELECT count(*) FROM public.__drizzle_control_migrations
      WHERE (asset_id, hash) IN (VALUES
        ('@sentropic/artifacts/migrations/0009_upload_pages.sql', '692d13ae0cabff0c0bd0977c1c083db561b120e89d5539b41bd58d981f315532'),
        ('@sentropic/artifacts/migrations/0010_git_bindings.sql', '896947eec4898a0918bab2f5d236718095296952ea37c1012fa448c779041de1'),
        ('@sentropic/artifacts/migrations/0011_live_drafts.sql', 'cc5399440c5531224fdd99337703cf3caebdd39d0f79df527efe3b6d6edf3fa4'),
        ('@sentropic/artifacts/migrations/0012_git_attach_intents.sql', '8cfb72c5337dcf6305909af52d789940d1944bcf5fca4e4e2d845d745c8d19f8'),
        ('@sentropic/artifacts/migrations/0013_live_invitations.sql', 'fb839f4579df640032a16cadc7cf66a987542701ba853a78e5889d0a2a31f65b'),
        ('@sentropic/artifacts/migrations/0014_db_blob_placement.sql', 'ef3ae125f9831ea5bae793868d7564bffb7d737610929ce370fe4b0bc3c14906')
      )) <> 6 THEN
    RAISE EXCEPTION 'Rollback requires the six qualified migration receipts';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS control.artifact_image_rollback_receipts (
  asset_id text PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL
);
INSERT INTO control.artifact_image_rollback_receipts (asset_id, hash, created_at)
SELECT asset_id, hash, created_at FROM public.__drizzle_control_migrations
WHERE asset_id ~ '^@sentropic/artifacts/migrations/00(09|1[0-4])_';
DELETE FROM public.__drizzle_control_migrations WHERE asset_id IN (
  '@sentropic/artifacts/migrations/0009_upload_pages.sql',
  '@sentropic/artifacts/migrations/0010_git_bindings.sql',
  '@sentropic/artifacts/migrations/0011_live_drafts.sql',
  '@sentropic/artifacts/migrations/0012_git_attach_intents.sql',
  '@sentropic/artifacts/migrations/0013_live_invitations.sql',
  '@sentropic/artifacts/migrations/0014_db_blob_placement.sql'
);
COMMIT;
