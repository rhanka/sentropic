-- Live re-drive pending scan (package redriveLiveWorkers, host timer at boot and every <= 60 s).
-- The pending() query filters one storage scope on JSONB phase and orders by last access time; DORMANT
-- rows (the idle majority) stay out of this partial index so every tick scans pending rows only.
CREATE INDEX IF NOT EXISTS live_drafts_pending_idx ON artifacts.live_drafts
  (storage_scope_id, (record #>> '{runtime,lastAccessAt}'), artifact_id, binding_generation)
  WHERE (record #>> '{runtime,phase}' IN ('REVIVING','QUIESCING','SAVING','DECOMMISSIONING')
    OR (record #>> '{runtime,phase}' = 'LIVE'));
