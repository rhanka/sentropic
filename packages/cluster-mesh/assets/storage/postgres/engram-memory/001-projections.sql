CREATE TABLE __MEMORY_SCHEMA__.memory_entries (
  scope_key text NOT NULL,
  map_kind text NOT NULL CHECK (map_kind IN ('record', 'aggregate', 'chain-record')),
  entry_key text NOT NULL,
  payload_id text NOT NULL,
  ordinal numeric(20,0) NOT NULL CHECK (ordinal >= 0 AND ordinal <= 18446744073709551615),
  event_id text,
  intent_hash text,
  scope_ref text,
  state text,
  PRIMARY KEY (scope_key, map_kind, entry_key, payload_id)
);
CREATE UNIQUE INDEX memory_event_identity ON __MEMORY_SCHEMA__.memory_entries(scope_key, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX memory_projection_page ON __MEMORY_SCHEMA__.memory_entries(scope_key, map_kind, ordinal, entry_key);
