-- T3 window classifier, version t3-classify-v1.
-- Every statement is safe on ANY schema revision: no static reference to an
-- optional relation. The driver runs Q1 first, then Q2..Q6 conditionally.
-- See deploy/ci/preprod-a4/t3-window-driver.mjs for the exact call order.
-- Q1: journal presence + live migration lock (pg_catalog only: always safe).
SELECT to_regclass('public.__drizzle_control_migrations') IS NOT NULL AS journal_present,
  (SELECT count(*)::int FROM pg_locks
    WHERE locktype = 'advisory' AND granted
      AND objid = hashtext('sentropic:api-migrations')) AS api_migration_locks;
-- Q2: run only when journal_present is true. Columns id/hash/created_at are
-- guaranteed by api/src/db/run-migrations.ts (CREATE TABLE journal).
SELECT EXISTS(SELECT 1 FROM public.__drizzle_control_migrations
  WHERE created_at = 1793577600000) AS identity_committed;
-- Q3: artifact receipt column presence (information_schema: always safe).
SELECT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = '__drizzle_control_migrations'
    AND column_name = 'asset_id') AS asset_column_present;
-- Q4: run only when asset_column_present is true.
SELECT count(*)::int AS asset_receipts
  FROM public.__drizzle_control_migrations WHERE asset_id IS NOT NULL;
-- Q5: artifact relation presence (to_regclass per name: dynamic, always safe).
-- Never reference control.artifact_packages: that relation does not exist.
SELECT name, to_regclass(name) IS NOT NULL AS present
  FROM unnest(ARRAY['control.artifact_host_kv',
    'public.__drizzle_control_migrations',
    'artifacts.artifacts',
    'artifact_host.activation_namespaces']) AS name;
-- Q6: encrypted-store stability rows (settings columns key/user_id/value exist
-- on every revision; only ids and lengths leave the database, never values).
SELECT s.key AS k, s.user_id AS u, length(s.value) AS len
  FROM public.settings s WHERE s.value LIKE 'enc:%' ORDER BY k, u;
