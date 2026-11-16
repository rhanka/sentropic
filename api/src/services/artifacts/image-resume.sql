-- Offline only, before restarting the T4a image after a prepared rollback.
-- Restore original receipts, never replay non-idempotent additive constraints.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('sentropic:artifact-package-migrations'));
INSERT INTO public.__drizzle_control_migrations (asset_id, hash, created_at)
SELECT asset_id, hash, created_at FROM control.artifact_image_rollback_receipts;
-- Retain the archived proof across rollback/resume cycles.
COMMIT;
