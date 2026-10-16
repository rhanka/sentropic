ALTER TABLE "control"."session_content_grants" ADD COLUMN "authority_epoch" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "control"."session_content_reservations" ADD COLUMN "authority_epoch" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "control"."session_content_objects" ADD COLUMN "authority_epoch" text NOT NULL;
