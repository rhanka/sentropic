-- CMF-S2 — DB blob placement (additive, IF NOT EXISTS only).
--
-- `artifacts.blobs.placement` records where the bytes of a registered blob
-- live: 'object' (S3 placement, pre-0014 rows read as such) or 'db'
-- (`artifacts.blob_bytes`). `artifacts.blob_bytes` carries NO foreign key to
-- `artifacts.blobs`: preparation-phase `putBlob` runs before `registerBlob`
-- commits inside finalization, so prepared bytes must land without a parent
-- row; unreferenced prepared bytes stay protected by `artifacts.object_intents`
-- and collected by the lifecycle GC. `artifacts.upload_staging_bytes` is the
-- DB-mode staging buffer (`artifacts/<scope>/staging/<uploadId>`), swept by
-- TTL like the object-prefix staging sweeper.
ALTER TABLE artifacts.blobs
  ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT 'object'
    CHECK (placement IN ('object', 'db'));

CREATE TABLE IF NOT EXISTS artifacts.blob_bytes (
  storage_scope_id TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, digest)
);

CREATE TABLE IF NOT EXISTS artifacts.upload_staging_bytes (
  storage_scope_id TEXT NOT NULL,
  upload_id UUID NOT NULL,
  bytes BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, upload_id)
);
CREATE INDEX IF NOT EXISTS upload_staging_bytes_by_updated
  ON artifacts.upload_staging_bytes (updated_at);
