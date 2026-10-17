ALTER TABLE "control"."session_content_objects" ADD COLUMN "reservation_id" text;
--> statement-breakpoint
CREATE INDEX "session_content_objects_reservation_idx" ON "control"."session_content_objects" USING btree ("reservation_id");
