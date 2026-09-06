CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_capacity_leases" (
	"lease_id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"subject_ref" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_capacity_leases_status_check" CHECK ("control"."cluster_mesh_capacity_leases"."status" IN ('reserved', 'active', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_commands" (
	"command_id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"target_registration_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"refusal_reason" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_commands_action_check" CHECK ("control"."cluster_mesh_commands"."action" IN ('drive', 'wake', 'relaunch')),
	CONSTRAINT "cluster_mesh_commands_status_check" CHECK ("control"."cluster_mesh_commands"."status" IN ('pending', 'accepted', 'refused', 'acted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_generations" (
	"generation_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"supervisor_ref" text NOT NULL,
	"supervisor_lease_expires_at" timestamp with time zone NOT NULL,
	"max_concurrent" integer NOT NULL,
	"pool_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "cluster_mesh_generations_status_check" CHECK ("control"."cluster_mesh_generations"."status" IN ('starting', 'active', 'draining', 'stopped', 'lost')),
	CONSTRAINT "cluster_mesh_generations_capacity_check" CHECK ("control"."cluster_mesh_generations"."max_concurrent" > 0 AND "control"."cluster_mesh_generations"."pool_size" > 0 AND "control"."cluster_mesh_generations"."pool_size" <= "control"."cluster_mesh_generations"."max_concurrent")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_mcp_servers" (
	"server_id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"supervisor_ref" text NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_mcp_servers_status_check" CHECK ("control"."cluster_mesh_mcp_servers"."status" IN ('starting', 'active', 'stopped', 'lost'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_namespace_cutovers" (
	"composition_root" text NOT NULL,
	"namespace" text NOT NULL,
	"selected_generation_id" text NOT NULL,
	"previous_generation_id" text,
	"active_author" text NOT NULL,
	"status" text DEFAULT 'shadow' NOT NULL,
	"shadow_comparison" jsonb,
	"rollback_checkpoint" jsonb,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_namespace_cutovers_pk" PRIMARY KEY("composition_root","namespace"),
	CONSTRAINT "cluster_mesh_namespace_cutovers_root_check" CHECK ("control"."cluster_mesh_namespace_cutovers"."composition_root" IN ('product', 'auth-idp')),
	CONSTRAINT "cluster_mesh_namespace_cutovers_status_check" CHECK ("control"."cluster_mesh_namespace_cutovers"."status" IN ('shadow', 'active', 'rolled_back', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_receipts" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"command_id" text,
	"invocation_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"stage" text NOT NULL,
	"decision" text,
	"refusal_reason" text,
	"effect_ref" text,
	"outbox_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_receipts_stage_check" CHECK ("control"."cluster_mesh_receipts"."stage" IN ('transported', 'verified', 'acted')),
	CONSTRAINT "cluster_mesh_receipts_decision_check" CHECK ("control"."cluster_mesh_receipts"."decision" IS NULL OR "control"."cluster_mesh_receipts"."decision" IN ('accepted', 'refused'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."cluster_mesh_registrations" (
	"registration_id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"nhi_principal_id" text NOT NULL,
	"custody_holder_principal_id" text NOT NULL,
	"custody_epoch" integer NOT NULL,
	"actuator_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_mesh_registrations_status_check" CHECK ("control"."cluster_mesh_registrations"."status" IN ('active', 'revoked', 'lost')),
	CONSTRAINT "cluster_mesh_registrations_custody_epoch_check" CHECK ("control"."cluster_mesh_registrations"."custody_epoch" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "control"."cluster_mesh_receipts" ADD CONSTRAINT "cluster_mesh_receipts_outbox_event_id_event_outbox_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "control"."event_outbox"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_capacity_leases_recovery_idx" ON "control"."cluster_mesh_capacity_leases" USING btree ("generation_id","status","lease_expires_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cluster_mesh_commands_target_idempotency_unique" ON "control"."cluster_mesh_commands" USING btree ("target_registration_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_commands_pending_target_idx" ON "control"."cluster_mesh_commands" USING btree ("generation_id","target_registration_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_generations_supervisor_lease_idx" ON "control"."cluster_mesh_generations" USING btree ("status","supervisor_lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cluster_mesh_mcp_servers_generation_unique" ON "control"."cluster_mesh_mcp_servers" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_mcp_servers_lease_idx" ON "control"."cluster_mesh_mcp_servers" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_namespace_cutovers_active_idx" ON "control"."cluster_mesh_namespace_cutovers" USING btree ("composition_root","status","selected_generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cluster_mesh_receipts_outbox_event_unique" ON "control"."cluster_mesh_receipts" USING btree ("outbox_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cluster_mesh_receipts_invocation_stage_unique" ON "control"."cluster_mesh_receipts" USING btree ("invocation_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_receipts_command_stage_idx" ON "control"."cluster_mesh_receipts" USING btree ("command_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cluster_mesh_registrations_active_lookup_idx" ON "control"."cluster_mesh_registrations" USING btree ("generation_id","workspace_id","nhi_principal_id","status","expires_at","lease_expires_at");

-- cluster-mesh-r13-down: execute this block with sentropic.cluster_mesh_r13_rollback=on
-- after deactivating cutovers and draining active leases. event_outbox is intentionally retained.
DO $cluster_mesh_r13_down$ BEGIN
	IF current_setting('sentropic.cluster_mesh_r13_rollback', true) = 'on' THEN
		DROP TABLE IF EXISTS "control"."cluster_mesh_receipts";
		DROP TABLE IF EXISTS "control"."cluster_mesh_commands";
		DROP TABLE IF EXISTS "control"."cluster_mesh_namespace_cutovers";
		DROP TABLE IF EXISTS "control"."cluster_mesh_mcp_servers";
		DROP TABLE IF EXISTS "control"."cluster_mesh_capacity_leases";
		DROP TABLE IF EXISTS "control"."cluster_mesh_registrations";
		DROP TABLE IF EXISTS "control"."cluster_mesh_generations";
	END IF;
END $cluster_mesh_r13_down$;
