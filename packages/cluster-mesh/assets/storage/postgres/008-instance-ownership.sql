-- 008-instance-ownership: canonical single-holder ownership (E4/G3).
-- One row per owning module: the durable winning pair (instance, epoch).
-- Epochs stay exact-u64 TEXT end to end (no Number conversion): the CHECK
-- accepts canonical decimal strings bounded to 2^64 - 1, compared as text.
-- Published 001-007 assets stay byte-identical; only this version is new.
-- Note: no chr(0) guard: PostgreSQL text cannot hold NUL bytes (the server
-- rejects them natively) and instances are generated, never caller-supplied.
CREATE TABLE __DATA_SCHEMA__.instance_ownership (
  module text PRIMARY KEY,
  instance text NOT NULL CHECK (length(instance) > 0 AND length(instance) <= 256),
  epoch text NOT NULL CHECK (epoch ~ '^[1-9][0-9]*$' AND (length(epoch) < 20 OR epoch <= '18446744073709551615'))
);
