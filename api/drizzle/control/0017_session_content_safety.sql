ALTER TABLE "control"."session_content_projects" ADD COLUMN "read_denied" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "control"."session_content_grants" ADD COLUMN "read_denied" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "control"."session_content_projects" SET "read_denied" = true WHERE "state" = 'revoked';
--> statement-breakpoint
UPDATE "control"."session_content_grants" SET "read_denied" = true WHERE "state" = 'revoked';
--> statement-breakpoint
ALTER TABLE "control"."session_content_objects" ADD COLUMN "writer_state" text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "control"."session_content_objects" ADD CONSTRAINT "session_content_objects_writer_state_check" CHECK ("writer_state" IN ('admitted', 'settled', 'unknown'));
--> statement-breakpoint
UPDATE "control"."session_content_objects" SET "writer_state" = 'settled' WHERE "state" IN ('committed', 'purged');
--> statement-breakpoint
CREATE INDEX "session_content_purge_jobs_pending_idx" ON "control"."session_content_purge_jobs" ("state", "updated_at", "purge_job_id");
