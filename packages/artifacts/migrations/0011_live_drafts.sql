-- Private draft namespace: no publication blob key, manifest or reader grant references it.
CREATE TABLE IF NOT EXISTS artifacts.live_drafts (
  storage_scope_id text NOT NULL,
  artifact_id uuid NOT NULL,
  binding_generation bigint NOT NULL CHECK (binding_generation > 0),
  record jsonb NOT NULL,
  PRIMARY KEY (storage_scope_id, artifact_id, binding_generation)
);
CREATE TABLE IF NOT EXISTS artifacts.live_draft_objects (
  storage_scope_id text NOT NULL,
  artifact_id uuid NOT NULL,
  binding_generation bigint NOT NULL,
  object_ref uuid NOT NULL,
  envelope jsonb NOT NULL,
  PRIMARY KEY (storage_scope_id, artifact_id, binding_generation, object_ref)
);
CREATE TABLE IF NOT EXISTS artifacts.live_commands (
  storage_scope_id text NOT NULL,
  actor_id text NOT NULL,
  command_key text NOT NULL,
  command_hash text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (storage_scope_id, actor_id, command_key)
);
CREATE TABLE IF NOT EXISTS artifacts.live_commit_quota (
  storage_scope_id text NOT NULL,
  actor_id text NOT NULL,
  artifact_id uuid NOT NULL,
  invocation_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (storage_scope_id, actor_id, invocation_id)
);
CREATE INDEX IF NOT EXISTS live_commit_quota_window ON artifacts.live_commit_quota(storage_scope_id, created_at);

CREATE OR REPLACE FUNCTION artifacts.reject_live_object_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'live draft objects are immutable';
END;
$$;
DROP TRIGGER IF EXISTS live_object_immutable ON artifacts.live_draft_objects;
CREATE TRIGGER live_object_immutable BEFORE UPDATE ON artifacts.live_draft_objects
  FOR EACH STATEMENT EXECUTE FUNCTION artifacts.reject_live_object_update();
