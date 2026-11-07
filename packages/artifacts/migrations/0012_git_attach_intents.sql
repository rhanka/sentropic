-- SG3 git_attach, A-LIVE v2 §5.3.1. Additive only: one nullable audit column and one intent table.
-- branch_created is true only on the attach event that verified creation of its branch.
ALTER TABLE artifacts.git_binding_events ADD COLUMN branch_created BOOLEAN NULL;
ALTER TABLE artifacts.git_binding_events ADD CONSTRAINT git_binding_events_branch_created
  CHECK (branch_created IS NULL OR (branch_created AND action = 'attach'));
-- Written before the forge createBranch, keyed like the replay receipt (scope, actor, key).
CREATE TABLE artifacts.git_attach_intents (
  storage_scope_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL CHECK (branch LIKE 'artifact/%'),
  base_commit_sha TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (storage_scope_id, actor_id, idempotency_key),
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts(id, storage_scope_id)
);
