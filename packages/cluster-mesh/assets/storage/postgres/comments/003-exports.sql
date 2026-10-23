CREATE TABLE __COMMENTS_SCHEMA__.comments_exports (
  scope_key TEXT NOT NULL,
  export_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  incarnation TEXT NOT NULL,
  selection_digest TEXT NOT NULL,
  state BYTEA NOT NULL,
  PRIMARY KEY(scope_key,export_id)
);
