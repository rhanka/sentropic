CREATE SCHEMA IF NOT EXISTS __COMMENTS_SCHEMA__;
CREATE TABLE __COMMENTS_SCHEMA__.comments_chains (
  scope_key text NOT NULL, chain_key text COLLATE "C" NOT NULL,
  PRIMARY KEY (scope_key,chain_key)
);
CREATE TABLE __COMMENTS_SCHEMA__.comments_headers (
  scope_key text NOT NULL, chain_key text COLLATE "C" NOT NULL, hash text NOT NULL,
  selection jsonb NOT NULL, links jsonb NOT NULL,
  PRIMARY KEY (scope_key,chain_key,hash),
  FOREIGN KEY (scope_key,chain_key) REFERENCES __COMMENTS_SCHEMA__.comments_chains(scope_key,chain_key)
);
CREATE TABLE __COMMENTS_SCHEMA__.comments_resources (
  scope_key text NOT NULL, resource_key text COLLATE "C" NOT NULL,
  chain_key text COLLATE "C" NOT NULL, hash text NOT NULL,
  PRIMARY KEY (scope_key,resource_key,chain_key,hash),
  FOREIGN KEY (scope_key,chain_key,hash) REFERENCES __COMMENTS_SCHEMA__.comments_headers(scope_key,chain_key,hash)
);
CREATE INDEX comments_resources_chain ON __COMMENTS_SCHEMA__.comments_resources(scope_key,chain_key,hash);
