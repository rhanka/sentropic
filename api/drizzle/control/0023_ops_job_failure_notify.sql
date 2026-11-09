-- Notify L1: platform job-failure incidents, delivery audit and ingestion idempotence.
-- One incident per (target_key, job_namespace, job_name); '' is the absent-namespace
-- sentinel so the unique triple stays total (NULLs never conflict in Postgres).
CREATE TABLE IF NOT EXISTS control.ops_incidents (
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
  last_mail_at timestamp with time zone,
  escalation_level integer NOT NULL DEFAULT 0,
  last_escalation_at timestamp with time zone,
  resolved_at timestamp with time zone,
  last_heartbeat_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ops_incidents_status_check CHECK (status IN ('firing', 'resolved')),
  CONSTRAINT ops_incidents_kind_check CHECK (job_kind IN ('CronJob', 'Job', 'app-job')),
  CONSTRAINT ops_incidents_escalation_check CHECK (escalation_level IN (0, 1)),
  CONSTRAINT ops_incidents_occurrence_check CHECK (occurrence_count >= 0),
  CONSTRAINT ops_incidents_consecutive_check CHECK (consecutive_failures >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ops_incidents_target_job_unique
  ON control.ops_incidents (target_key, job_namespace, job_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ops_incidents_status_idx ON control.ops_incidents (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ops_incidents_status_heartbeat_idx
  ON control.ops_incidents (status, last_heartbeat_at);
--> statement-breakpoint
-- Append-only mail audit: one row per requested alert mail. Recipients are
-- resolved at send time and recorded on the row.
CREATE TABLE IF NOT EXISTS control.ops_notification_deliveries (
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
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ops_deliveries_kind_check CHECK (kind IN ('firing', 'digest', 'escalation', 'recovery')),
  CONSTRAINT ops_deliveries_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  CONSTRAINT ops_deliveries_attempts_check CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ops_deliveries_incident_idx
  ON control.ops_notification_deliveries (incident_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ops_deliveries_status_idx
  ON control.ops_notification_deliveries (status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ops_deliveries_target_sent_idx
  ON control.ops_notification_deliveries (target_key, status, sent_at);
--> statement-breakpoint
-- Ingestion idempotence log: the primary key IS the dedup (replayed eventIds
-- insert nothing and create no incident and no mail).
CREATE TABLE IF NOT EXISTS control.ops_seen_events (
  event_id text PRIMARY KEY,
  incident_id text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now()
);
