-- 007-consumed-counters: exact-u64 storage for semantic counters (E2/C5).
-- Widens the semantic counter columns from signed BIGINT to NUMERIC(20)
-- with a u64-range CHECK. Existing values are preserved by the rewrite.
-- Published 001-006 assets stay byte-identical; only this version is new.
-- Physical map-node IDs (map_nodes, map roots/positions) and bounded
-- operational columns (staged ordinals, consumer cursors, limits) are
-- intentionally untouched: see the E2 inventory in BRANCH.md.
ALTER TABLE __DATA_SCHEMA__.scopes ALTER COLUMN version TYPE NUMERIC(20), ALTER COLUMN sequence TYPE NUMERIC(20);
ALTER TABLE __DATA_SCHEMA__.scopes ADD CONSTRAINT scopes_version_u64 CHECK (version <= 18446744073709551615);
ALTER TABLE __DATA_SCHEMA__.scopes ADD CONSTRAINT scopes_sequence_u64 CHECK (sequence <= 18446744073709551615);
ALTER TABLE __DATA_SCHEMA__.fences ALTER COLUMN epoch TYPE NUMERIC(20);
ALTER TABLE __DATA_SCHEMA__.fences ADD CONSTRAINT fences_epoch_u64 CHECK (epoch <= 18446744073709551615);
ALTER TABLE __DATA_SCHEMA__.journal ALTER COLUMN sequence TYPE NUMERIC(20);
ALTER TABLE __DATA_SCHEMA__.journal ADD CONSTRAINT journal_sequence_u64 CHECK (sequence <= 18446744073709551615);
ALTER TABLE __DATA_SCHEMA__.boundaries ALTER COLUMN version TYPE NUMERIC(20), ALTER COLUMN sequence TYPE NUMERIC(20);
ALTER TABLE __DATA_SCHEMA__.boundaries ADD CONSTRAINT boundaries_version_u64 CHECK (version <= 18446744073709551615);
ALTER TABLE __DATA_SCHEMA__.boundaries ADD CONSTRAINT boundaries_sequence_u64 CHECK (sequence <= 18446744073709551615);
