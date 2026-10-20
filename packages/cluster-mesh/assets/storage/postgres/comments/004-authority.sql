CREATE TABLE __COMMENTS_SCHEMA__.comments_authority (
  scope_key TEXT NOT NULL,
  chain_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  targets BYTEA NOT NULL,
  PRIMARY KEY(scope_key,chain_key,hash)
);
