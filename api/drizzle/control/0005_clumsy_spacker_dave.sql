CREATE TABLE IF NOT EXISTS "control"."cost_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"tenant_id" text,
	"agent_id" text,
	"session_id" text,
	"run_id" text,
	"operation" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"credential_source" text,
	"finish_reason" text,
	"response_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"total_tokens" integer,
	"usage_raw" jsonb,
	"cost_micro_usd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_ledger_operation_check" CHECK ("control"."cost_ledger"."operation" IN ('generate', 'stream'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_ledger_idempotency_key_unique" ON "control"."cost_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_ledger_user_workspace_idx" ON "control"."cost_ledger" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_ledger_created_at_idx" ON "control"."cost_ledger" USING btree ("created_at");
