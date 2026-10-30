CREATE TABLE IF NOT EXISTS canvas_live_documents (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  document_id text NOT NULL,
  baseline jsonb NOT NULL,
  schema_epoch text NOT NULL,
  head integer NOT NULL DEFAULT 0 CHECK (head >= 0),
  checkpoint jsonb,
  PRIMARY KEY (tenant_id, workspace_id, document_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS canvas_live_journal (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  document_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  body jsonb NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, document_id, seq),
  FOREIGN KEY (tenant_id, workspace_id, document_id)
    REFERENCES canvas_live_documents (tenant_id, workspace_id, document_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS canvas_live_checkpoints (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  document_id text NOT NULL,
  checkpoint_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, document_id, checkpoint_id),
  FOREIGN KEY (tenant_id, workspace_id, document_id)
    REFERENCES canvas_live_documents (tenant_id, workspace_id, document_id)
);
