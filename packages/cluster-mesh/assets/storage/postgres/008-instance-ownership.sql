-- 008-instance-ownership: canonical single-holder ownership (E4/G3).
-- One row per owning module: the durable winning pair (instance, epoch) plus
-- the retained lease (holder_until, server clock). The holder keeps the row
-- live by renewal; a second opener is refused while the lease lives, and may
-- take over only after it expires. Epochs stay exact-u64 TEXT end to end (no
-- Number conversion): the CHECK bounds canonical decimal strings to 20 digits
-- and u64 max with C collation (deterministic byte order, no locale effects).
-- Published 001-007 assets stay byte-identical; only this version is new.
-- Note: no chr(0) guard: PostgreSQL text cannot hold NUL bytes (the server
-- rejects them natively) and instances are generated, never caller-supplied.
CREATE TABLE __DATA_SCHEMA__.instance_ownership (
  module text PRIMARY KEY,
  instance text NOT NULL CHECK (length(instance) > 0 AND length(instance) <= 256),
  epoch text NOT NULL CHECK (epoch ~ '^[1-9][0-9]*$' AND (length(epoch) < 20 OR (length(epoch) = 20 AND epoch COLLATE "C" <= '18446744073709551615'))),
  holder_until timestamptz NOT NULL
);
-- Installed final guard: a deferred constraint trigger re-checks lease
-- liveness at COMMIT time, inside the committing transaction. The JS guard
-- verifies exact codes and renews the lease before the commit decision; the
-- trigger is the backstop (expiry between renewal and COMMIT, writers that
-- bypass the JS guard). Non-opt-in kernels never touch this row, so the
-- trigger never fires for them.
CREATE FUNCTION __DATA_SCHEMA__.instance_ownership_guard() RETURNS trigger
  LANGUAGE plpgsql AS $instance_ownership_guard$
  BEGIN
    IF NEW.holder_until IS NULL OR NEW.holder_until <= clock_timestamp() THEN
      RAISE EXCEPTION 'instance lease not live' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END;
$instance_ownership_guard$;
CREATE CONSTRAINT TRIGGER instance_ownership_lease
  AFTER UPDATE ON __DATA_SCHEMA__.instance_ownership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION __DATA_SCHEMA__.instance_ownership_guard();
