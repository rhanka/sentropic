-- L-5b — artifacts domain schema (spec-v8 §9).
--
-- Owned by the artifact domain; executed by the Immo host through its
-- existing migration journal (at most one root-app migration; preferred
-- Immo-owned adapter). Additive only: no ALTER/DROP of existing objects.
-- 5b tables: storage scopes, artifacts (stable bindings), releases, current
-- pointer, blobs, uploads, object intents, idempotency keys. Sharing/access,
-- lifecycle/GC and hostname reservations arrive with L-5c migrations.
-- Release states are CHECK-closed to ('ready') in this lot; L-5c extends
-- the set with its own additive migration.

CREATE SCHEMA IF NOT EXISTS artifacts;

-- Opaque storage scope isolating physical keys from org reindexing.
CREATE TABLE IF NOT EXISTS artifacts.storage_scopes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Artifact with owner-scoped stable binding (one UUID per owner+binding).
CREATE TABLE IF NOT EXISTS artifacts.artifacts (
  id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL REFERENCES artifacts.storage_scopes (id),
  owner_id TEXT NOT NULL,
  binding_name TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storage_scope_id, owner_id, binding_name)
);

-- Immutable sealed releases (canonical manifest bytes + digest).
CREATE TABLE IF NOT EXISTS artifacts.releases (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  manifest_digest TEXT NOT NULL,
  manifest JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS releases_by_artifact ON artifacts.releases (artifact_id);

-- Current release pointer (CAS-promoted; the loser's release stays orphan).
CREATE TABLE IF NOT EXISTS artifacts.artifact_current (
  artifact_id UUID PRIMARY KEY REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  release_id UUID NOT NULL REFERENCES artifacts.releases (id) ON DELETE RESTRICT
);

-- Addressed blobs (deduplicated by scope+digest; pins arrive in L-5c).
CREATE TABLE IF NOT EXISTS artifacts.blobs (
  storage_scope_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, digest)
);

-- Bounded upload sessions (ephemeral staging ledger for GC).
CREATE TABLE IF NOT EXISTS artifacts.uploads (
  id UUID PRIMARY KEY,
  max_size INTEGER NOT NULL CHECK (max_size > 0),
  size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  mime_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'committed', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_by_state ON artifacts.uploads (state);

-- Object intents recorded before every external operation.
CREATE TABLE IF NOT EXISTS artifacts.object_intents (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('commit-release', 'delete-blob', 'promote-release')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intents_pending ON artifacts.object_intents (state, created_at)
  WHERE state = 'pending';

-- Operation idempotency: one stored result per key.
CREATE TABLE IF NOT EXISTS artifacts.idempotency_keys (
  key TEXT PRIMARY KEY,
  params_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
