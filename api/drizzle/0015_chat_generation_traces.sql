-- Chat tracing (debug/audit): store the exact OpenAI payloads + tool calls per iteration.
-- Retention is enforced at the application level (purge > 7 days).
CREATE TABLE IF NOT EXISTS "chat_generation_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"phase" text NOT NULL,
	"iteration" integer NOT NULL,
	"model" text,
	"tool_choice" text,
	"tools" jsonb,
	"openai_messages" jsonb NOT NULL,
	"tool_calls" jsonb,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_generation_traces" ADD CONSTRAINT "chat_generation_traces_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_generation_traces" ADD CONSTRAINT "chat_generation_traces_assistant_message_id_chat_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_generation_traces" ADD CONSTRAINT "chat_generation_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_generation_traces" ADD CONSTRAINT "chat_generation_traces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_generation_traces_session_id_idx" ON "chat_generation_traces" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_generation_traces_assistant_message_id_idx" ON "chat_generation_traces" USING btree ("assistant_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_generation_traces_created_at_idx" ON "chat_generation_traces" USING btree ("created_at");


