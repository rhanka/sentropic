-- Parity P0 — artifact display metadata (title/description/icon).
--
-- Additive upgrade after 0004_terminal_controls: no column is dropped or narrowed, existing
-- rows keep working (default '{}' preserves "no metadata" semantics). The host
-- applies this file through its existing migration journal.

ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
