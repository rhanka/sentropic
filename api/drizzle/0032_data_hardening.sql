-- BR-44 Data Hardening migration
-- WI-1: job_queue — attempts column + started_at/completed_at text→timestamptz + (status,started_at) index
-- WI-2: chat_stream_events — created_at index
-- WI-3: drop task_io_contracts (dead table, zero live refs, no FK inbound)

--> statement-breakpoint
ALTER TABLE "job_queue" ADD COLUMN "attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "started_at" TYPE timestamp with time zone USING "started_at"::timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "job_queue" ALTER COLUMN "completed_at" TYPE timestamp with time zone USING "completed_at"::timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_queue_status_started_at_idx" ON "job_queue" USING btree ("status","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_stream_events_created_at_idx" ON "chat_stream_events" USING btree ("created_at");
--> statement-breakpoint
DROP TABLE IF EXISTS "task_io_contracts";
