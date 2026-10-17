CREATE TABLE __COMMENTS_SCHEMA__.comments_preparations (
  scope_key text NOT NULL, operation_id text NOT NULL, kernel_operation text NOT NULL,
  owner text NOT NULL, incarnation text NOT NULL, unit_id text,
  batch_id text NOT NULL, manifest_hash text NOT NULL, state bytea NOT NULL,
  PRIMARY KEY (scope_key,operation_id), UNIQUE (scope_key,kernel_operation), UNIQUE (scope_key,unit_id)
);
CREATE INDEX comments_preparations_batch ON __COMMENTS_SCHEMA__.comments_preparations(scope_key,batch_id,manifest_hash,operation_id);
CREATE TABLE __COMMENTS_SCHEMA__.comments_fragment_receipts (
  scope_key text NOT NULL, operation_id text NOT NULL, ordinal bigint NOT NULL CHECK (ordinal >= 0),
  transport_digest text NOT NULL, kernel_digest text NOT NULL, acknowledgement bytea NOT NULL,
  PRIMARY KEY (scope_key,operation_id,ordinal),
  FOREIGN KEY (scope_key,operation_id) REFERENCES __COMMENTS_SCHEMA__.comments_preparations(scope_key,operation_id)
);
