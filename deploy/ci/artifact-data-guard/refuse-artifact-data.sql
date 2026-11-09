-- Refuse a whole-database restore over a database that holds artifact data (owner rule
-- 2026-11-08: preprod updates keep preprod artifacts). Read-only: it raises on the first
-- non-empty artifacts.* or control.artifact_* table and never prints a row.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
DECLARE
  item record;
  present boolean;
BEGIN
  FOR item IN SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = 'artifacts' OR (schemaname = 'control' AND tablename LIKE 'artifact\_%')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)', item.schemaname, item.tablename) INTO present;
    IF present THEN
      RAISE EXCEPTION 'artifact_data_present: %.% holds rows; the restore would delete preprod artifacts',
        item.schemaname, item.tablename;
    END IF;
  END LOOP;
END
$guard$;
ROLLBACK;
