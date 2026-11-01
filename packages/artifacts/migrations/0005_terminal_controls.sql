-- Terminal deletion retains the identity and receipts; physical purge remains host policy.
ALTER TABLE artifacts.artifacts ADD COLUMN IF NOT EXISTS terminal_deleted_at TIMESTAMPTZ;
ALTER TABLE artifacts.artifacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- Defaults affect new identities only; historical modification times remain unknown.
ALTER TABLE artifacts.artifacts ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION artifacts.reject_terminal_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terminal_deleted_at IS NOT NULL AND
    (NEW.terminal_deleted_at IS DISTINCT FROM OLD.terminal_deleted_at OR NEW.lifecycle_state NOT IN ('deleted', 'purged')
      OR NEW.renewed_at IS DISTINCT FROM OLD.renewed_at) THEN
    RAISE EXCEPTION 'terminal artifact' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS terminal_restore_guard ON artifacts.artifacts;
CREATE TRIGGER terminal_restore_guard BEFORE UPDATE ON artifacts.artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_restore();

CREATE OR REPLACE FUNCTION artifacts.reject_terminal_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM artifacts.artifacts WHERE id = NEW.artifact_id AND terminal_deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'terminal artifact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS terminal_release_guard ON artifacts.releases;
CREATE TRIGGER terminal_release_guard BEFORE INSERT ON artifacts.releases
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_publication();

CREATE OR REPLACE FUNCTION artifacts.record_publication_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE artifacts.artifacts SET updated_at = NEW.created_at WHERE id = NEW.artifact_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS publication_updated_at ON artifacts.releases;
CREATE TRIGGER publication_updated_at AFTER INSERT ON artifacts.releases
FOR EACH ROW EXECUTE FUNCTION artifacts.record_publication_update();
DROP TRIGGER IF EXISTS terminal_pointer_guard ON artifacts.artifact_current;
CREATE TRIGGER terminal_pointer_guard BEFORE INSERT OR UPDATE ON artifacts.artifact_current
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_publication();
