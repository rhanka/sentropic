-- L-5c — lifecycle, sharing, sources and GC schema (spec-v8 §9).
--
-- Additive upgrade over 0001: no column is dropped or narrowed, existing
-- rows keep working (defaults preserve 5b semantics: artifacts start
-- active, releases start ready). `commit` is a reserved word: the source
-- commit column is named `commit_tx`. Release states widen from ('ready')
-- to ('ready','retired','purged'); artifact lifecycle, grants, sources and
-- GC holders/pins are new tables. Sharing grants, lifecycle transitions and
-- refcounts stay consistent through the Postgres adapter (no api/src
-- imports); the host applies this file through its existing journal.

-- Artifact lifecycle state + renewal marker.
ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'withdrawn', 'deleted', 'purged')),
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;

-- Widen release states: ready (committed/current) → retired (supplanted) → purged (cascade).
ALTER TABLE artifacts.releases DROP CONSTRAINT IF EXISTS releases_state_check;
ALTER TABLE artifacts.releases
  ADD CONSTRAINT releases_state_check CHECK (state IN ('ready', 'retired', 'purged'));

-- Sharing grants: exact (artifact, principal) pairs, no wildcards.
CREATE TABLE IF NOT EXISTS artifacts.artifact_access (
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  grant TEXT NOT NULL CHECK (grant IN ('read', 'source')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, principal_id)
);

-- Explicit source provenance per artifact (recipe/base commit/inline-original marker).
CREATE TABLE IF NOT EXISTS artifacts.artifact_sources (
  artifact_id UUID PRIMARY KEY REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inline-original', 'base-commit', 'recipe')),
  commit_tx TEXT,
  steps JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GC refcount holders: one row per (digest, holder); counts derive by COUNT.
CREATE TABLE IF NOT EXISTS artifacts.blob_ref_holders (
  digest TEXT NOT NULL,
  holder TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (digest, holder)
);
CREATE INDEX IF NOT EXISTS ref_holders_by_digest ON artifacts.blob_ref_holders (digest);

-- GC pins: explicit retention against concurrent collection.
CREATE TABLE IF NOT EXISTS artifacts.blob_pins (
  digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (digest, reason)
);
