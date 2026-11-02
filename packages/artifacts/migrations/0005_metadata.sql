-- Parity P0 — artifact display metadata (title/description/icon).
--
-- Additive upgrade after 0004_terminal_controls: no column is dropped or narrowed, existing
-- rows keep working (default '{}' preserves "no metadata" semantics). The host
-- applies this file through its existing migration journal.

ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Historical authors and lineage remain unknown; populate these on new commits only.
ALTER TABLE artifacts.releases
  ADD COLUMN IF NOT EXISTS author_principal_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_release_id UUID,
  ADD COLUMN IF NOT EXISTS reverted_from_release_id UUID;
