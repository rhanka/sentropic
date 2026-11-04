-- Files parity LOT 2 §A — browser upload pages (additive, IF NOT EXISTS).
--
-- One row per minted browser upload page: the token hash (never the token),
-- the bound artifact/scope/owner, and the page file bound. Rows are kept
-- after expiry for audit; the sweeper flips them to 'expired'.
CREATE TABLE IF NOT EXISTS artifacts.upload_pages (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  storage_scope_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'exchanged', 'closed', 'expired')),
  max_files INTEGER NOT NULL CHECK (max_files > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exchanged_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS upload_pages_by_expiry ON artifacts.upload_pages (state, expires_at)
  WHERE state IN ('open', 'exchanged');

-- Agent-channel rows stay NULL; browser sessions carry their page.
ALTER TABLE artifacts.uploads
  ADD COLUMN IF NOT EXISTS page_session_id UUID REFERENCES artifacts.upload_pages (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS uploads_by_page ON artifacts.uploads (page_session_id)
  WHERE page_session_id IS NOT NULL;
