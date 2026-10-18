-- Applied only by the host migration authority; identifiers are rendered
-- from validated layout configuration. Canonical payloads remain bytea.
CREATE TABLE __DATA_SCHEMA__.modules (module text PRIMARY KEY, incarnation text NOT NULL);
CREATE TABLE __DATA_SCHEMA__.grants (
  module text NOT NULL, token text NOT NULL, bytes bytea NOT NULL, revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (module, token)
);
CREATE TABLE __DATA_SCHEMA__.map_nodes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text COLLATE "C" NOT NULL, value bytea, left_id bigint, right_id bigint,
  height integer NOT NULL CHECK (height > 0), size bigint NOT NULL CHECK (size > 0)
);
CREATE TABLE __DATA_SCHEMA__.scopes (
  key text PRIMARY KEY, module text NOT NULL, tenant text NOT NULL, workspace text NOT NULL,
  incarnation text NOT NULL, root bigint, version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0), UNIQUE (module, tenant, workspace)
);
CREATE TABLE __DATA_SCHEMA__.payloads (
  id text PRIMARY KEY, scope_key text NOT NULL, target text NOT NULL,
  bytes bytea, hash text NOT NULL, erased boolean NOT NULL DEFAULT false,
  CHECK (NOT erased OR bytes IS NULL)
);
CREATE INDEX payloads_target ON __DATA_SCHEMA__.payloads(scope_key, target, id);
CREATE TABLE __DATA_SCHEMA__.fences (
  scope_key text NOT NULL, lane text NOT NULL, owner text NOT NULL, incarnation text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch >= 0), lease_until timestamptz,
  PRIMARY KEY (scope_key, lane)
);
CREATE TABLE __DATA_SCHEMA__.units (
  scope_key text NOT NULL, operation text NOT NULL, id text NOT NULL UNIQUE,
  owner text NOT NULL, capability text NOT NULL, metadata jsonb NOT NULL,
  PRIMARY KEY (scope_key, operation)
);
CREATE TABLE __DATA_SCHEMA__.fragments (
  unit_id text NOT NULL, ordinal bigint NOT NULL CHECK (ordinal >= 0),
  digest text NOT NULL, predecessor text, effects bytea, metadata jsonb NOT NULL,
  PRIMARY KEY (unit_id, ordinal)
);
CREATE TABLE __DATA_SCHEMA__.journal (
  scope_key text NOT NULL, sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL UNIQUE, event jsonb NOT NULL, PRIMARY KEY (scope_key, sequence)
);
CREATE TABLE __DATA_SCHEMA__.consumers (
  scope_key text NOT NULL, consumer text NOT NULL, state jsonb NOT NULL,
  PRIMARY KEY (scope_key, consumer)
);
CREATE TABLE __DATA_SCHEMA__.boundaries (
  scope_key text NOT NULL, token text NOT NULL, owner text NOT NULL,
  root bigint, version bigint NOT NULL, sequence bigint NOT NULL, metadata jsonb NOT NULL,
  PRIMARY KEY (scope_key, token)
);
