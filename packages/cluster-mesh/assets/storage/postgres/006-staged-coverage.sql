CREATE TABLE __DATA_SCHEMA__.staged_coverage (
  scope_key text NOT NULL, unit_id text NOT NULL, child text COLLATE "C" NOT NULL, parent text NOT NULL,
  PRIMARY KEY (scope_key,unit_id,child),
  FOREIGN KEY (unit_id) REFERENCES __DATA_SCHEMA__.units(id)
);
