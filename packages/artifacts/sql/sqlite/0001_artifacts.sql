-- U1 — SQLite DDL for the artifacts domain, owned by the SQLite adapter
-- (applied by openSqliteDatabase, never by the host migration journal).
--
-- SQLite has no schemas: the Postgres `artifacts.<table>` names map to plain
-- `<table>` in the single local file. Column types map TIMESTAMPTZ -> TEXT
-- (ISO-8601 UTC strings), JSONB -> TEXT (JSON), BOOLEAN -> INTEGER 0/1,
-- UUID -> TEXT, and gen_random_uuid() is supplied by the adapter. The 0004
-- terminal guards are enforced in adapter code (all writes are serialized
-- through one BEGIN IMMEDIATE writer, so check-then-write is atomic); the
-- publication updated_at side effect is folded into putRelease. Semantics
-- are identical to migrations/0001..0005.sql.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_scopes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  storage_scope_id TEXT NOT NULL REFERENCES storage_scopes (id),
  owner_id TEXT NOT NULL,
  binding_name TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'withdrawn', 'deleted', 'purged')),
  renewed_at TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  terminal_deleted_at TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE (storage_scope_id, owner_id, binding_name)
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  manifest_digest TEXT NOT NULL,
  manifest TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'retired', 'purged')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  author_principal_id TEXT,
  parent_release_id TEXT,
  reverted_from_release_id TEXT
);
CREATE INDEX IF NOT EXISTS releases_by_artifact ON releases (artifact_id);

CREATE TABLE IF NOT EXISTS artifact_current (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts (id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES releases (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS blobs (
  storage_scope_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (storage_scope_id, digest)
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  max_size INTEGER NOT NULL CHECK (max_size > 0),
  size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  mime_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'committed', 'discarded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS uploads_by_state ON uploads (state);

CREATE TABLE IF NOT EXISTS object_intents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('commit-release', 'delete-blob', 'promote-release')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  payload TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS intents_pending ON object_intents (state, created_at)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  params_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS artifact_access (
  artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'source')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (artifact_id, principal_id)
);

CREATE TABLE IF NOT EXISTS artifact_sources (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inline-original', 'base-commit', 'recipe')),
  commit_tx TEXT,
  steps TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blob_ref_holders (
  digest TEXT NOT NULL,
  holder TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (digest, holder)
);
CREATE INDEX IF NOT EXISTS ref_holders_by_digest ON blob_ref_holders (digest);

CREATE TABLE IF NOT EXISTS blob_pins (
  digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (digest, reason)
);

CREATE TABLE IF NOT EXISTS operation_keys (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (storage_scope_id, internal_key)
);

CREATE TABLE IF NOT EXISTS operation_receipts (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  command_codec TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  receipt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (storage_scope_id, internal_key)
);
