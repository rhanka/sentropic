ALTER TABLE "control"."session_content_reservations" ADD COLUMN "project_revision" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "control"."session_content_reservations" ADD COLUMN "grant_version" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "control"."session_content_reservations" ADD COLUMN "retention_snapshot" jsonb NOT NULL;
