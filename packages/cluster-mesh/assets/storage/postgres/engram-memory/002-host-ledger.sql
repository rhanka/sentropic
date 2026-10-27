CREATE TABLE __MEMORY_SCHEMA__.memory_host_ledger (
  candidate_id text PRIMARY KEY,
  store_id text NOT NULL,
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  invocation_id text NOT NULL,
  host_principal text NOT NULL,
  continuation_ids text[] NOT NULL DEFAULT '{}',
  envelope_digest text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'terminal', 'ambiguous')),
  receipt jsonb,
  cursor text
);
CREATE INDEX memory_host_ledger_invocation ON __MEMORY_SCHEMA__.memory_host_ledger(invocation_id);
