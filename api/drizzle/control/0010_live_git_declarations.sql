CREATE TABLE IF NOT EXISTS "control"."live_git_declarations" (
	"declaration_key" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"live_capability" text NOT NULL,
	"status" text DEFAULT 'declared' NOT NULL,
	"withdrawal" jsonb,
	"withdrawal_reason" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_git_declarations_live_capability_check" CHECK ("control"."live_git_declarations"."live_capability" IN ('live')),
	CONSTRAINT "live_git_declarations_status_check" CHECK ("control"."live_git_declarations"."status" IN ('declared', 'withdrawn')),
	CONSTRAINT "live_git_declarations_withdrawal_reason_check" CHECK ("control"."live_git_declarations"."withdrawal_reason" IS NULL OR "control"."live_git_declarations"."withdrawal_reason" IN ('workspace-remove', 'owner-request', 'policy-withdrawn')),
	CONSTRAINT "live_git_declarations_withdrawal_coherence_check" CHECK (("control"."live_git_declarations"."status" = 'withdrawn') = ("control"."live_git_declarations"."withdrawn_at" IS NOT NULL) AND ("control"."live_git_declarations"."status" = 'withdrawn') = ("control"."live_git_declarations"."withdrawal" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_git_declarations_tenant_status_idx" ON "control"."live_git_declarations" USING btree ("tenant_id","status");
