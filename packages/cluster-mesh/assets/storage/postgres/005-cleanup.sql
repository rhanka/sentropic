ALTER TABLE __DATA_SCHEMA__.payloads ADD COLUMN prepared_unit text;
CREATE INDEX payloads_prepared_unit ON __DATA_SCHEMA__.payloads(prepared_unit,id);
CREATE INDEX staged_items_unit_id ON __DATA_SCHEMA__.staged_items(unit_id,id);
