-- Notify L1: platform job-failure incidents, delivery audit and ingestion idempotence.
-- One incident per (target_key, job_namespace, job_name); '' is the absent-namespace
-- sentinel so the unique triple stays total (NULLs never conflict in Postgres).
--
-- Drift policy: plain CREATE TABLE / CREATE INDEX (no IF NOT EXISTS) so a
-- pre-existing incompatible schema fails loudly instead of being validated
-- silently. Tables are soft-referenced only (control-namespace rule: no FK).
--
-- Retention: ops_seen_events and ops_notification_deliveries are audit trail.
-- No automated purge in v1; a retention purge (90 days) is backlog until
-- `control.event_audit` (ARCH-14) becomes the projection target.
CREATE TABLE control.ops_incidents (
  id text PRIMARY KEY,
  target_key text NOT NULL,
  job_namespace text NOT NULL DEFAULT '',
  job_name text NOT NULL,
  job_kind text NOT NULL,
  status text NOT NULL DEFAULT 'firing',
  first_seen_at timestamp with time zone NOT NULL,
  last_seen_at timestamp with time zone NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_reason text,
  last_severity text,
  last_run_id text,
  last_event_id text NOT NULL,
  last_links jsonb,
  last_detail text,
  last_mail_at timestamp with time zone,
  escalation_level integer NOT NULL DEFAULT 0,
  last_escalation_at timestamp with time zone,
  resolved_at timestamp with time zone,
  last_heartbeat_at timestamp with time zone,
  last_occurred_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ops_incidents_status_check CHECK (status IN ('firing', 'resolved')),
  CONSTRAINT ops_incidents_kind_check CHECK (job_kind IN ('CronJob', 'Job', 'app-job')),
  CONSTRAINT ops_incidents_escalation_check CHECK (escalation_level IN (0, 1)),
  CONSTRAINT ops_incidents_occurrence_check CHECK (occurrence_count >= 0),
  CONSTRAINT ops_incidents_consecutive_check CHECK (consecutive_failures >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ops_incidents_target_job_unique
  ON control.ops_incidents (target_key, job_namespace, job_name);
--> statement-breakpoint
CREATE INDEX ops_incidents_status_idx ON control.ops_incidents (status);
--> statement-breakpoint
CREATE INDEX ops_incidents_status_heartbeat_idx
  ON control.ops_incidents (status, last_heartbeat_at);
--> statement-breakpoint
-- Append-only mail audit: one row per requested alert mail. Recipients are
-- resolved at send time and recorded on the row with their admin basis.
-- `next_attempt_at` requeues transient failures and cap-suppressed sends with
-- a backoff instead of dropping them: the claim only takes rows whose
-- `next_attempt_at` is null or due.
CREATE TABLE control.ops_notification_deliveries (
  id text PRIMARY KEY,
  incident_id text NOT NULL,
  target_key text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  event_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  message_id text,
  sent_at timestamp with time zone,
  next_attempt_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ops_deliveries_kind_check CHECK (kind IN ('firing', 'digest', 'escalation', 'recovery', 'config')),
  CONSTRAINT ops_deliveries_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  CONSTRAINT ops_deliveries_attempts_check CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX ops_deliveries_incident_idx
  ON control.ops_notification_deliveries (incident_id);
--> statement-breakpoint
CREATE INDEX ops_deliveries_status_idx
  ON control.ops_notification_deliveries (status, created_at);
--> statement-breakpoint
CREATE INDEX ops_deliveries_pending_idx
  ON control.ops_notification_deliveries (status, next_attempt_at, created_at);
--> statement-breakpoint
CREATE INDEX ops_deliveries_target_sent_idx
  ON control.ops_notification_deliveries (target_key, status, sent_at);
--> statement-breakpoint
-- Ingestion idempotence log: the primary key IS the eventId dedup. A replayed
-- `eventId` with a different payload hash is a 409 conflict, not a silent
-- no-op. `canonical_key` is the cross-source run key (target/job/run/outcome
-- without the source prefix): the second source reporting the same execution
-- is a duplicate that opens no incident and queues no mail.
CREATE TABLE control.ops_seen_events (
  event_id text PRIMARY KEY,
  incident_id text NOT NULL,
  payload_sha256 text NOT NULL,
  canonical_key text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX ops_seen_events_canonical_idx
  ON control.ops_seen_events (canonical_key);
