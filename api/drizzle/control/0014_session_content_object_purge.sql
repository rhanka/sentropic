ALTER TABLE "control"."session_content_purge_jobs" ADD COLUMN "object_id" text;
--> statement-breakpoint
ALTER TABLE "control"."session_content_purge_jobs" DROP CONSTRAINT "session_content_purge_jobs_scope_check";
--> statement-breakpoint
ALTER TABLE "control"."session_content_purge_jobs" ADD CONSTRAINT "session_content_purge_jobs_scope_check" CHECK ("control"."session_content_purge_jobs"."scope" IN ('binding', 'namespace', 'history', 'object'));
