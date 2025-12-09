CREATE TABLE IF NOT EXISTS "chat_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"context_type" text NOT NULL,
	"context_id" text NOT NULL,
	"snapshot_before" jsonb,
	"snapshot_after" jsonb,
	"modifications" jsonb,
	"modified_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"reasoning" text,
	"model" text,
	"prompt_id" text,
	"prompt_version_id" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"primary_context_type" text,
	"primary_context_id" text,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_stream_events" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"stream_id" text NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "context_modification_history" (
	"id" text PRIMARY KEY NOT NULL,
	"context_type" text NOT NULL,
	"context_id" text NOT NULL,
	"session_id" text,
	"message_id" text,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"tool_call_id" text,
	"prompt_id" text,
	"prompt_type" text,
	"prompt_version_id" text,
	"job_id" text,
	"sequence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_contexts" ADD CONSTRAINT "chat_contexts_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_stream_events" ADD CONSTRAINT "chat_stream_events_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_modification_history" ADD CONSTRAINT "context_modification_history_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_modification_history" ADD CONSTRAINT "context_modification_history_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "context_modification_history" ADD CONSTRAINT "context_modification_history_job_id_job_queue_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_queue"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contexts_session_id_idx" ON "chat_contexts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contexts_context_idx" ON "chat_contexts" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contexts_context_type_id_idx" ON "chat_contexts" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_session_id_idx" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_sequence_idx" ON "chat_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_prompt_version_id_idx" ON "chat_messages" USING btree ("prompt_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_user_id_idx" ON "chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_primary_context_idx" ON "chat_sessions" USING btree ("primary_context_type","primary_context_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_stream_events_message_id_idx" ON "chat_stream_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_stream_events_stream_id_idx" ON "chat_stream_events" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_stream_events_sequence_idx" ON "chat_stream_events" USING btree ("stream_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_stream_events_stream_id_sequence_unique" ON "chat_stream_events" USING btree ("stream_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_modification_history_context_idx" ON "context_modification_history" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_modification_history_session_id_idx" ON "context_modification_history" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_modification_history_sequence_idx" ON "context_modification_history" USING btree ("context_type","context_id","sequence");