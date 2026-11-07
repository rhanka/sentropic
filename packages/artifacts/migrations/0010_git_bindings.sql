-- SG1, G0 FROZEN v3 §2. Additive; live sessions have a separate later migration.
CREATE UNIQUE INDEX artifacts_id_scope_git ON artifacts.artifacts(id, storage_scope_id);
CREATE TABLE artifacts.git_bindings (
  artifact_id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL CHECK (branch LIKE 'artifact/%'),
  channel TEXT NOT NULL CHECK (channel IN ('personal', 'shared')),
  personal_principal_id TEXT,
  sub_path TEXT NOT NULL,
  base_commit_sha TEXT NOT NULL,
  head_commit_sha TEXT,
  release_commit_sha TEXT,
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  executor TEXT NOT NULL CHECK (executor IN ('caller', 'ci', 'sandbox')),
  pending_job_id TEXT,
  pending_commit_sha TEXT,
  state TEXT NOT NULL CHECK (state IN ('attached', 'syncing', 'build_pending', 'build_failed',
    'diverged', 'paused', 'detached', 'error')),
  state_detail TEXT,
  generation INTEGER NOT NULL CHECK (generation > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  attached_by TEXT NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts(id, storage_scope_id),
  CHECK ((channel = 'personal') = (personal_principal_id IS NOT NULL)),
  CHECK ((pending_job_id IS NULL) = (pending_commit_sha IS NULL))
);
CREATE UNIQUE INDEX git_bindings_active_artifact ON artifacts.git_bindings(artifact_id) WHERE state <> 'detached';
CREATE UNIQUE INDEX git_bindings_active_branch ON artifacts.git_bindings(repo_id, branch) WHERE state <> 'detached';
CREATE INDEX git_bindings_scope ON artifacts.git_bindings(storage_scope_id, artifact_id);

CREATE TABLE artifacts.git_binding_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id UUID NOT NULL,
  storage_scope_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('attach', 'pause', 'resume', 'detach', 'commit', 'inbound',
    'publish', 'conflict', 'resolve', 'error')),
  before_sha TEXT,
  after_sha TEXT,
  delivery_id TEXT,
  invocation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts(id, storage_scope_id)
);
CREATE INDEX git_binding_events_scope ON artifacts.git_binding_events(storage_scope_id, artifact_id, created_at);

ALTER TABLE artifacts.releases ADD COLUMN git_commit TEXT NULL;
CREATE UNIQUE INDEX releases_id_artifact_git ON artifacts.releases(id, artifact_id);
CREATE TABLE artifacts.git_release_index (
  release_id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  storage_scope_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  tree_sha TEXT,
  manifest_digest TEXT NOT NULL,
  candidate_digest TEXT NOT NULL,
  executor TEXT NOT NULL CHECK (executor IN ('caller', 'ci', 'sandbox')),
  verification TEXT NOT NULL CHECK (verification IN ('declared', 'sha-verified', 'builder-attested')),
  receipt_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  build_run_id TEXT,
  attempt INTEGER CHECK (attempt > 0),
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts(id, storage_scope_id),
  FOREIGN KEY (release_id, artifact_id) REFERENCES artifacts.releases(id, artifact_id)
);
CREATE INDEX git_release_index_commit ON artifacts.git_release_index(storage_scope_id, artifact_id, commit_sha);

CREATE FUNCTION artifacts.reject_git_record_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: git audit and release index are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER git_binding_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artifacts.git_binding_events
  FOR EACH STATEMENT EXECUTE FUNCTION artifacts.reject_git_record_mutation();
CREATE TRIGGER git_release_index_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON artifacts.git_release_index
  FOR EACH STATEMENT EXECUTE FUNCTION artifacts.reject_git_record_mutation();
