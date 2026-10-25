-- L3 (immo #861) — atomic finalization coordination (spec r2 §3.1 A4).
--
-- Additive only: no ALTER/DROP of existing objects. Two coordinator-owned
-- tables. artifacts.operation_keys is the per-key serialization row keyed by
-- (storage_scope_id, internal_key); it carries no success or authorization
-- assertion. artifacts.operation_receipts holds exactly one success row per
-- (storage_scope_id, internal_key) with the command codec, command hash and
-- receipt; the primary key is the uniqueness fence. This migration is
-- distinct from artifacts.idempotency_keys, whose success-row count MUST
-- stay unchanged after a denial. The host applies this file through its
-- existing journal after 0002_lifecycle.sql.

CREATE TABLE IF NOT EXISTS artifacts.operation_keys (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, internal_key)
);

CREATE TABLE IF NOT EXISTS artifacts.operation_receipts (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  command_codec TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, internal_key)
);
