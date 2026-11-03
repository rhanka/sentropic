-- G1 — three-mode sharing ACL (converged-r2 §2.1/§2.2 + owner answers Q1–Q3).
--
-- Additive upgrade over 0005: no column is dropped or narrowed, existing rows
-- keep working. `access_mode` closes the wide audience to the three values;
-- legacy `is_public = true` maps to 'platform', NEVER 'public' (zero artifacts
-- become anonymous through the migration). `is_public` stays as a read-only
-- legacy projection of `access_mode` (`<> 'restricted'`); the adapter writes
-- both together and the forced `is_public = false` writes are removed in code.
-- `artifact_access_events` is the append-only audit trail written in the same
-- transaction as the mutation (actor, action, audience, target principal,
-- policy revision, timestamp — no tokens, no names).
-- Owner Q1 is enforced at the schema level: the collab (`source`) right is
-- nominative only — at most one source grant per artifact, only while the
-- artifact is `restricted`, and no mode widening while a source grant exists.

ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'restricted'
    CHECK (access_mode IN ('restricted', 'platform', 'public'));

-- Legacy public flag reads as platform, never public.
UPDATE artifacts.artifacts SET access_mode = 'platform' WHERE is_public = true;

-- Append-only access audit events (same transaction as the mutation).
CREATE TABLE IF NOT EXISTS artifacts.artifact_access_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  audience TEXT NOT NULL CHECK (audience IN ('user', 'platform', 'public')),
  principal_id TEXT,
  policy_revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_events_by_artifact ON artifacts.artifact_access_events (artifact_id);

CREATE OR REPLACE FUNCTION artifacts.reject_access_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: artifact_access_events is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_access_events_append_only ON artifacts.artifact_access_events;
CREATE TRIGGER artifact_access_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON artifacts.artifact_access_events
  FOR EACH STATEMENT EXECUTE FUNCTION artifacts.reject_access_event_mutation();

-- Owner Q1, schema level: at most one collab (source) grant per artifact.
CREATE UNIQUE INDEX IF NOT EXISTS artifact_access_one_source
  ON artifacts.artifact_access (artifact_id) WHERE permission = 'source';

CREATE OR REPLACE FUNCTION artifacts.reject_source_outside_restricted() RETURNS trigger AS $$
DECLARE
  current_mode TEXT;
BEGIN
  IF NEW.permission = 'source' THEN
    SELECT access_mode INTO current_mode FROM artifacts.artifacts WHERE id = NEW.artifact_id;
    IF current_mode IS DISTINCT FROM 'restricted' THEN
      RAISE EXCEPTION 'source grant requires restricted mode (artifact % is %)', NEW.artifact_id, current_mode;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_access_source_guard ON artifacts.artifact_access;
CREATE TRIGGER artifact_access_source_guard
  BEFORE INSERT OR UPDATE OF permission ON artifacts.artifact_access
  FOR EACH ROW EXECUTE FUNCTION artifacts.reject_source_outside_restricted();

-- Owner Q1, schema level: no mode widening while a collab (source) grant exists.
CREATE OR REPLACE FUNCTION artifacts.reject_widening_with_source_grant() RETURNS trigger AS $$
BEGIN
  IF (OLD.access_mode = 'restricted' AND NEW.access_mode IN ('platform', 'public'))
     OR (OLD.access_mode = 'platform' AND NEW.access_mode = 'public') THEN
    IF EXISTS (SELECT 1 FROM artifacts.artifact_access
               WHERE artifact_id = NEW.id AND permission = 'source') THEN
      RAISE EXCEPTION 'cannot widen access_mode of artifact % while a source grant exists', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifacts_widening_source_guard ON artifacts.artifacts;
CREATE TRIGGER artifacts_widening_source_guard
  BEFORE UPDATE OF access_mode ON artifacts.artifacts
  FOR EACH ROW EXECUTE FUNCTION artifacts.reject_widening_with_source_grant();
