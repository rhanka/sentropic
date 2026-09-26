CREATE TABLE IF NOT EXISTS "control"."blocked_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text,
	"principal_kind" text NOT NULL,
	"principal_key" text NOT NULL,
	"budget_strategy_id" text,
	"reason" text NOT NULL,
	"budget_id" text,
	"requested_model" text,
	"hold_id" text,
	"quote_ref" text,
	"liability_micro_usd" bigint,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_attempts_principal_kind_check" CHECK ("control"."blocked_attempts"."principal_kind" IN ('user', 'service', 'guest', 'anonymous', 'system')),
	CONSTRAINT "blocked_attempts_reason_check" CHECK ("control"."blocked_attempts"."reason" IN ('cap', 'no_pricing', 'no_strategy', 'missing_bucket', 'overrun', 'killswitch', 'rate')),
	CONSTRAINT "blocked_attempts_liability_check" CHECK ("control"."blocked_attempts"."liability_micro_usd" IS NULL OR "control"."blocked_attempts"."liability_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."budget_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text,
	"principal_kind" text NOT NULL,
	"principal_key" text NOT NULL,
	"budget_strategy_id" text NOT NULL,
	"budget_ids" text[] NOT NULL,
	"quote_ref" text NOT NULL,
	"pricing_versions" text[] NOT NULL,
	"liability_micro_usd" bigint NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"owner_ref" text NOT NULL,
	"fence" bigint DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"dispatch_started_at" timestamp with time zone,
	"dispatched_attempts" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_holds_principal_kind_check" CHECK ("control"."budget_holds"."principal_kind" IN ('user', 'service', 'guest', 'anonymous', 'system')),
	CONSTRAINT "budget_holds_status_check" CHECK ("control"."budget_holds"."status" IN ('held', 'dispatched', 'settled', 'released', 'reconciled')),
	CONSTRAINT "budget_holds_amounts_check" CHECK ("control"."budget_holds"."liability_micro_usd" >= 0 AND "control"."budget_holds"."fence" >= 0 AND "control"."budget_holds"."dispatched_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text,
	"scope_kind" text NOT NULL,
	"scope_key" text NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"cap_micro_usd" bigint,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_scope_kind_check" CHECK ("control"."budgets"."scope_kind" IN ('tenant', 'workspace', 'principal', 'model', 'anonymous_pool')),
	CONSTRAINT "budgets_workspace_scope_check" CHECK ("control"."budgets"."scope_kind" <> 'workspace' OR "control"."budgets"."workspace_id" IS NOT NULL),
	CONSTRAINT "budgets_period_check" CHECK ("control"."budgets"."period" IN ('monthly')),
	CONSTRAINT "budgets_amounts_check" CHECK ("control"."budgets"."reserved_micro_usd" >= 0 AND "control"."budgets"."spent_micro_usd" >= 0 AND ("control"."budgets"."cap_micro_usd" IS NULL OR "control"."budgets"."cap_micro_usd" >= 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."model_pricing" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"input_micro_usd_per_mtok" bigint NOT NULL,
	"output_micro_usd_per_mtok" bigint NOT NULL,
	"cached_input_micro_usd_per_mtok" bigint,
	"reasoning_micro_usd_per_mtok" bigint,
	"image_micro_usd_per_unit" bigint,
	"audio_micro_usd_per_unit" bigint,
	"tool_call_micro_usd_per_unit" bigint,
	"embedding_micro_usd_per_mtok" bigint,
	"min_charge_micro_usd" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_pricing_window_check" CHECK ("control"."model_pricing"."effective_to" IS NULL OR "control"."model_pricing"."effective_to" > "control"."model_pricing"."effective_from"),
	CONSTRAINT "model_pricing_rates_check" CHECK ("control"."model_pricing"."input_micro_usd_per_mtok" >= 0 AND "control"."model_pricing"."output_micro_usd_per_mtok" >= 0
        AND COALESCE("control"."model_pricing"."cached_input_micro_usd_per_mtok", 0) >= 0 AND COALESCE("control"."model_pricing"."reasoning_micro_usd_per_mtok", 0) >= 0
        AND COALESCE("control"."model_pricing"."image_micro_usd_per_unit", 0) >= 0 AND COALESCE("control"."model_pricing"."audio_micro_usd_per_unit", 0) >= 0
        AND COALESCE("control"."model_pricing"."tool_call_micro_usd_per_unit", 0) >= 0 AND COALESCE("control"."model_pricing"."embedding_micro_usd_per_mtok", 0) >= 0
        AND COALESCE("control"."model_pricing"."min_charge_micro_usd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."tenant_budget_strategy" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"funding_mode" text NOT NULL,
	"key_sourcing_mode" text NOT NULL,
	"mutualization_scope" text DEFAULT 'none' NOT NULL,
	"anonymous_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "tenant_budget_strategy_funding_mode_check" CHECK ("control"."tenant_budget_strategy"."funding_mode" IN ('tenant_pool', 'seat_pooled', 'sponsored', 'byok_user', 'mutualized')),
	CONSTRAINT "tenant_budget_strategy_key_sourcing_mode_check" CHECK ("control"."tenant_budget_strategy"."key_sourcing_mode" IN ('platform', 'user', 'workspace', 'mutualized')),
	CONSTRAINT "tenant_budget_strategy_mutualization_scope_check" CHECK ("control"."tenant_budget_strategy"."mutualization_scope" IN ('none', 'intra_tenant', 'cross_tenant')),
	CONSTRAINT "tenant_budget_strategy_status_check" CHECK ("control"."tenant_budget_strategy"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "principal_kind" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "principal_key" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "budget_strategy_id" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "pricing_version" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "hold_id" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "quote_ref" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "reconciliation_state" text;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD COLUMN "attempts" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "control"."budget_holds" ADD CONSTRAINT "budget_holds_budget_strategy_id_tenant_budget_strategy_id_fk" FOREIGN KEY ("budget_strategy_id") REFERENCES "control"."tenant_budget_strategy"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_attempts_tenant_workspace_created_idx" ON "control"."blocked_attempts" USING btree ("tenant_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_attempts_request_id_idx" ON "control"."blocked_attempts" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_holds_request_id_unique" ON "control"."budget_holds" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_holds_status_deadline_idx" ON "control"."budget_holds" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_holds_tenant_workspace_idx" ON "control"."budget_holds" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_tenant_scope_period_unique" ON "control"."budgets" USING btree ("tenant_id","scope_kind","scope_key","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_tenant_workspace_idx" ON "control"."budgets" USING btree ("tenant_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_pricing_provider_model_effective_from_unique" ON "control"."model_pricing" USING btree ("provider_id","model_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_budget_strategy_active_tenant_unique" ON "control"."tenant_budget_strategy" USING btree ("tenant_id") WHERE "control"."tenant_budget_strategy"."status" = 'active';--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD CONSTRAINT "cost_ledger_principal_kind_check" CHECK ("control"."cost_ledger"."principal_kind" IS NULL OR "control"."cost_ledger"."principal_kind" IN ('user', 'service', 'guest', 'anonymous', 'system')) NOT VALID;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD CONSTRAINT "cost_ledger_result_check" CHECK ("control"."cost_ledger"."result" IS NULL OR "control"."cost_ledger"."result" IN ('ok', 'capped', 'error', 'aborted')) NOT VALID;--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" ADD CONSTRAINT "cost_ledger_reconciliation_state_check" CHECK ("control"."cost_ledger"."reconciliation_state" IS NULL OR "control"."cost_ledger"."reconciliation_state" IN ('none', 'estimated', 'pending', 'reconciled')) NOT VALID;--> statement-breakpoint
-- Hand-edited (drizzle-kit cannot emit NOT VALID / VALIDATE / COMMENT): see BRANCH.md.
ALTER TABLE "control"."cost_ledger" VALIDATE CONSTRAINT "cost_ledger_principal_kind_check";--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" VALIDATE CONSTRAINT "cost_ledger_result_check";--> statement-breakpoint
ALTER TABLE "control"."cost_ledger" VALIDATE CONSTRAINT "cost_ledger_reconciliation_state_check";--> statement-breakpoint
COMMENT ON COLUMN "control"."cost_ledger"."principal_key" IS 'Opaque principal id or keyed hash only; never an e-mail, raw IP or other personal data in clear.';--> statement-breakpoint
COMMENT ON COLUMN "control"."budget_holds"."principal_key" IS 'Opaque principal id or keyed hash only; never an e-mail, raw IP or other personal data in clear.';--> statement-breakpoint
COMMENT ON COLUMN "control"."blocked_attempts"."principal_key" IS 'Opaque principal id or keyed hash only; never an e-mail, raw IP or other personal data in clear.';