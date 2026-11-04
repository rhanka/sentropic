-- Files parity LOT 1 — durable upload sessions (design-r1 §B.3, review
-- files-design-large4_r1 finding 1: 0001 already creates artifacts.uploads,
-- so this migration ALTERs it instead of recreating it).
--
-- 0001's uploads table was an ephemeral staging ledger (id, max_size, size,
-- mime_type, state, created_at) with no artifact binding and no expiry. LOT 1
-- binds every session to its artifact, storage scope and owner, adds
-- expires_at for the enforced staging sweeper (gc.ts), and adds the
-- staged-file records that commit_upload writes and publish_bundle
-- references. Pre-existing rows belong to the never-wired append surface:
-- they are discarded (not deleted) so no stale session stays open.

ALTER TABLE artifacts.uploads
  ADD COLUMN IF NOT EXISTS artifact_id UUID REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_scope_id TEXT REFERENCES artifacts.storage_scopes (id),
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Pre-existing rows have no artifact binding: close them, keep the audit trail.
UPDATE artifacts.uploads SET state = 'discarded' WHERE artifact_id IS NULL;

-- 'expired' is set by the sweeper when expires_at passes with the session open.
ALTER TABLE artifacts.uploads DROP CONSTRAINT IF EXISTS uploads_state_check;
ALTER TABLE artifacts.uploads
  ADD CONSTRAINT uploads_state_check CHECK (state IN ('open', 'committed', 'discarded', 'expired'));

CREATE INDEX IF NOT EXISTS uploads_by_expiry ON artifacts.uploads (state, expires_at)
  WHERE state = 'open';

-- Staged files: one row per committed upload, referenced by publish_bundle
-- assets ({path, uploadId}). The blob itself is content-addressed under
-- artifacts/<scope>/blobs/sha256/<hex>; this row carries the manifest path.
CREATE TABLE IF NOT EXISTS artifacts.staged_files (
  upload_id UUID PRIMARY KEY REFERENCES artifacts.uploads (id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, path)
);
CREATE INDEX IF NOT EXISTS staged_files_by_artifact ON artifacts.staged_files (artifact_id);
