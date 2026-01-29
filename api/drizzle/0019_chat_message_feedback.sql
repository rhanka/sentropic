-- Chat message feedback (Lot B2):
-- - Add chat_message_feedback table to store per-user 👍/👎 votes on assistant messages

CREATE TABLE IF NOT EXISTS "chat_message_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"vote" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_feedback_message_user_unique" ON "chat_message_feedback" USING btree ("message_id","user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_message_feedback_message_id_idx" ON "chat_message_feedback" USING btree ("message_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chat_message_feedback_user_id_idx" ON "chat_message_feedback" USING btree ("user_id");
--> statement-breakpoint

ALTER TABLE "chat_messages"
ADD COLUMN IF NOT EXISTS "contexts" jsonb;
