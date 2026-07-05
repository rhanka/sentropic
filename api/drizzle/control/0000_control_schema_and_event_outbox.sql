-- BR-60: control schema + event_outbox — first control-namespace resident.
-- Applied AFTER the public migration stream in run-migrations.ts.
-- Idempotent (IF NOT EXISTS everywhere).

-- Create the control schema namespace.
CREATE SCHEMA IF NOT EXISTS control;

-- control.event_outbox — transactional outbox table (ARCH-14 / SPEC_EVOL_OUTBOX_V0.md §1).
CREATE TABLE IF NOT EXISTS control.event_outbox (
  id                text         PRIMARY KEY,
  aggregate_type    text         NOT NULL,
  aggregate_id      text         NOT NULL,
  seq               bigint       NOT NULL,
  envelope          jsonb        NOT NULL,
  trace_id          text,
  lineage           jsonb,
  origin            text,
  tenant_id         text,
  workspace_id      text,
  status            text         NOT NULL DEFAULT 'pending',
  claimed_at        timestamptz,
  attempts          integer      NOT NULL DEFAULT 0,
  last_error        text,
  dispatched_at     timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  channel           text         NOT NULL,

  -- Per-aggregate ordering.
  CONSTRAINT event_outbox_aggregate_seq_unique UNIQUE (aggregate_type, aggregate_id, seq),

  -- Status domain.
  CONSTRAINT event_outbox_status_check CHECK (
    status IN ('pending', 'processing', 'dispatched', 'failed')
  ),

  -- Non-negative attempts.
  CONSTRAINT event_outbox_attempts_check CHECK (attempts >= 0)
);

-- Pending ordered dispatch index.
CREATE INDEX IF NOT EXISTS event_outbox_status_dispatch_idx
  ON control.event_outbox (status, aggregate_type, aggregate_id, seq);

-- DD9 isolation index.
CREATE INDEX IF NOT EXISTS event_outbox_tenant_workspace_idx
  ON control.event_outbox (tenant_id, workspace_id);
