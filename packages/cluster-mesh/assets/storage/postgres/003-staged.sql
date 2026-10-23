ALTER TABLE __DATA_SCHEMA__.fragments ADD COLUMN dependency_part bytea NOT NULL;
ALTER TABLE __DATA_SCHEMA__.fragments ADD COLUMN effect_part bytea NOT NULL;
CREATE TABLE __DATA_SCHEMA__.staged_items (
  id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  scope_key text NOT NULL, target text, unit_id text NOT NULL,
  ordinal bigint NOT NULL, section integer NOT NULL CHECK (section BETWEEN 0 AND 8),
  item integer NOT NULL CHECK (item >= 0), bytes bytea,
  cost integer NOT NULL CHECK (cost > 0), PRIMARY KEY (unit_id,ordinal,section,item)
);
CREATE INDEX staged_items_scope ON __DATA_SCHEMA__.staged_items(scope_key,id);
CREATE INDEX payloads_scope ON __DATA_SCHEMA__.payloads(scope_key,id);
