CREATE TABLE IF NOT EXISTS "control"."session_content_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"project_revision" integer DEFAULT 0 NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_incarnation" integer DEFAULT 1 NOT NULL,
	"owner_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"channels" jsonb NOT NULL,
	"future_sessions" boolean DEFAULT false NOT NULL,
	"selected_session_ids" jsonb NOT NULL,
	"named_histories" jsonb NOT NULL,
	"retention_by_channel" jsonb NOT NULL,
	"retention_digest" text NOT NULL,
	"accepted_policy" jsonb NOT NULL,
	"authority_epoch" text NOT NULL,
	"offline_read_accepted" boolean DEFAULT false NOT NULL,
	"exclusion_revision" integer DEFAULT 0 NOT NULL,
	"excluded_session_ids" jsonb NOT NULL,
	"requires_fresh_amendment" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_projects_state_check" CHECK ("control"."session_content_projects"."state" IN ('active', 'revoked', 'excluded')),
	CONSTRAINT "session_content_projects_revision_check" CHECK ("control"."session_content_projects"."project_revision" >= 0 AND "control"."session_content_projects"."exclusion_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_grants" (
	"grant_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"project_id" text NOT NULL,
	"project_revision" integer NOT NULL,
	"binding_id" text NOT NULL,
	"binding_version" integer NOT NULL,
	"d1_version" integer NOT NULL,
	"d1_incarnation" integer NOT NULL,
	"d1_start_seq" integer DEFAULT 0 NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"source_generation" text NOT NULL,
	"source_trust_version" text NOT NULL,
	"native_boundary_seq" integer DEFAULT 0 NOT NULL,
	"channels" jsonb NOT NULL,
	"retention_snapshot" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_freshness_ack_at" bigint DEFAULT 0 NOT NULL,
	"local_deny_pending" boolean DEFAULT false NOT NULL,
	"retained_copies" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_grants_state_check" CHECK ("control"."session_content_grants"."state" IN ('active', 'closed', 'revoked', 'excluded', 'expired')),
	CONSTRAINT "session_content_grants_version_check" CHECK ("control"."session_content_grants"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_history_authorizations" (
	"authorization_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"project_revision" integer NOT NULL,
	"ceilings" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_history_state_check" CHECK ("control"."session_content_history_authorizations"."state" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_namespaces" (
	"namespace_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"epoch" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_namespaces_status_check" CHECK ("control"."session_content_namespaces"."status" IN ('active', 'purge_pending', 'purged'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_objects" (
	"object_id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"session_id" text NOT NULL,
	"channel" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"bytes_raw" bigint DEFAULT 0 NOT NULL,
	"bytes_encoded" bigint DEFAULT 0 NOT NULL,
	"captured_at" bigint DEFAULT 0 NOT NULL,
	"expires_at" bigint,
	"state" text DEFAULT 'staged' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_objects_channel_check" CHECK ("control"."session_content_objects"."channel" IN ('terminal.cache', 'native.mirror')),
	CONSTRAINT "session_content_objects_state_check" CHECK ("control"."session_content_objects"."state" IN ('staged', 'committed', 'purge_pending', 'purged'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_reservations" (
	"reservation_id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"channel" text NOT NULL,
	"bytes_raw" bigint DEFAULT 0 NOT NULL,
	"bytes_encoded" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"attempt_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_reservations_state_check" CHECK ("control"."session_content_reservations"."state" IN ('reserved', 'published', 'consumed', 'cancelled', 'stale'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_attempts" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_digest" text NOT NULL,
	"outcome" text DEFAULT 'attempted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_attempts_outcome_check" CHECK ("control"."session_content_attempts"."outcome" IN ('attempted', 'published', 'conflicted', 'outcome_unknown', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_purge_jobs" (
	"purge_job_id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"binding_id" text,
	"scope" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "session_content_purge_jobs_state_check" CHECK ("control"."session_content_purge_jobs"."state" IN ('pending', 'in_progress', 'complete')),
	CONSTRAINT "session_content_purge_jobs_scope_check" CHECK ("control"."session_content_purge_jobs"."scope" IN ('binding', 'namespace', 'history'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_tombstones" (
	"tombstone_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"public_id" text NOT NULL,
	"tenant_id" text,
	"owner_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_content_tombstones_kind_check" CHECK ("control"."session_content_tombstones"."kind" IN ('tenant', 'user', 'workspace'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_admissions" (
	"admission_id" text PRIMARY KEY NOT NULL,
	"auth_session_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"credential_id" text NOT NULL,
	"origin" text NOT NULL,
	"user_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control"."session_content_offline_receipts" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"policy_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_projects_tenant_owner_idx" ON "control"."session_content_projects" USING btree ("tenant_id","owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_content_grants_session_unique" ON "control"."session_content_grants" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_grants_project_idx" ON "control"."session_content_grants" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_grants_tenant_owner_idx" ON "control"."session_content_grants" USING btree ("tenant_id","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_grants_binding_idx" ON "control"."session_content_grants" USING btree ("binding_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_history_session_idx" ON "control"."session_content_history_authorizations" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_history_binding_idx" ON "control"."session_content_history_authorizations" USING btree ("binding_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_namespaces_tenant_owner_epoch_idx" ON "control"."session_content_namespaces" USING btree ("tenant_id","owner_id","epoch");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_objects_namespace_idx" ON "control"."session_content_objects" USING btree ("namespace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_objects_binding_idx" ON "control"."session_content_objects" USING btree ("binding_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_objects_session_idx" ON "control"."session_content_objects" USING btree ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_content_objects_bucket_key_unique" ON "control"."session_content_objects" USING btree ("bucket","object_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_reservations_namespace_idx" ON "control"."session_content_reservations" USING btree ("namespace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_reservations_session_idx" ON "control"."session_content_reservations" USING btree ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_content_attempts_namespace_key_unique" ON "control"."session_content_attempts" USING btree ("namespace_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_attempts_session_idx" ON "control"."session_content_attempts" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_purge_jobs_namespace_idx" ON "control"."session_content_purge_jobs" USING btree ("namespace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_content_tombstones_kind_public_unique" ON "control"."session_content_tombstones" USING btree ("kind","public_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_tombstones_tenant_idx" ON "control"."session_content_tombstones" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_admissions_session_idx" ON "control"."session_content_admissions" USING btree ("auth_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_admissions_credential_idx" ON "control"."session_content_admissions" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_content_offline_receipts_project_idx" ON "control"."session_content_offline_receipts" USING btree ("project_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "control"."session_content_fence_tenant_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "control"."session_content_namespaces" WHERE "tenant_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_grants" WHERE "tenant_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_projects" WHERE "tenant_id" = OLD."id") THEN
		RETURN OLD;
	END IF;
	UPDATE "control"."session_content_grants" SET "state" = 'revoked', "updated_at" = now()
		WHERE "tenant_id" = OLD."id" AND "state" NOT IN ('revoked');
	UPDATE "control"."session_content_namespaces" SET "status" = 'purge_pending', "updated_at" = now()
		WHERE "tenant_id" = OLD."id" AND "status" = 'active';
	INSERT INTO "control"."session_content_purge_jobs" ("purge_job_id", "namespace_id", "scope", "state")
		SELECT 'purge-' || md5("namespace_id" || clock_timestamp()::text), "namespace_id", 'namespace', 'pending'
		FROM "control"."session_content_namespaces" WHERE "tenant_id" = OLD."id" AND "status" = 'purge_pending';
	INSERT INTO "control"."session_content_tombstones" ("tombstone_id", "kind", "public_id", "tenant_id", "reason")
		VALUES ('tombstone-tenant-' || md5(OLD."id" || clock_timestamp()::text), 'tenant', OLD."id", OLD."id", 'tenant deleted with D2 state')
		ON CONFLICT DO NOTHING;
	RETURN OLD;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "control"."session_content_fence_user_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "control"."session_content_namespaces" WHERE "owner_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_grants" WHERE "owner_id" = OLD."id") THEN
		RETURN OLD;
	END IF;
	UPDATE "control"."session_content_grants" SET "state" = 'revoked', "updated_at" = now()
		WHERE "owner_id" = OLD."id" AND "state" NOT IN ('revoked');
	UPDATE "control"."session_content_namespaces" SET "status" = 'purge_pending', "updated_at" = now()
		WHERE "owner_id" = OLD."id" AND "status" = 'active';
	INSERT INTO "control"."session_content_purge_jobs" ("purge_job_id", "namespace_id", "scope", "state")
		SELECT 'purge-' || md5("namespace_id" || clock_timestamp()::text), "namespace_id", 'namespace', 'pending'
		FROM "control"."session_content_namespaces" WHERE "owner_id" = OLD."id" AND "status" = 'purge_pending';
	INSERT INTO "control"."session_content_tombstones" ("tombstone_id", "kind", "public_id", "reason")
		VALUES ('tombstone-user-' || md5(OLD."id" || clock_timestamp()::text), 'user', OLD."id", 'user deleted with D2 state')
		ON CONFLICT DO NOTHING;
	RETURN OLD;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "control"."session_content_fence_workspace_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "control"."session_content_grants" WHERE "workspace_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_projects" WHERE "workspace_id" = OLD."id") THEN
		RETURN OLD;
	END IF;
	UPDATE "control"."session_content_projects" SET "state" = 'revoked', "updated_at" = now()
		WHERE "workspace_id" = OLD."id" AND "state" = 'active';
	UPDATE "control"."session_content_grants" SET "state" = 'revoked', "updated_at" = now()
		WHERE "workspace_id" = OLD."id" AND "state" NOT IN ('revoked');
	INSERT INTO "control"."session_content_purge_jobs" ("purge_job_id", "namespace_id", "binding_id", "scope", "state")
		SELECT DISTINCT 'purge-' || md5("binding_id" || clock_timestamp()::text),
			COALESCE((SELECT "namespace_id" FROM "control"."session_content_objects" WHERE "binding_id" = "g"."binding_id" LIMIT 1), 'namespace:unallocated'),
			"g"."binding_id", 'binding', 'pending'
		FROM "control"."session_content_grants" AS "g" WHERE "g"."workspace_id" = OLD."id";
	INSERT INTO "control"."session_content_tombstones" ("tombstone_id", "kind", "public_id", "tenant_id", "reason")
		VALUES ('tombstone-workspace-' || md5(OLD."id" || clock_timestamp()::text), 'workspace', OLD."id", OLD."tenant_id", 'workspace deleted with D2 state')
		ON CONFLICT DO NOTHING;
	RETURN OLD;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "control"."session_content_fence_tenant_offboard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "control"."session_content_namespaces" WHERE "tenant_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_grants" WHERE "tenant_id" = OLD."id")
		AND NOT EXISTS (SELECT 1 FROM "control"."session_content_projects" WHERE "tenant_id" = OLD."id") THEN
		RETURN NEW;
	END IF;
	UPDATE "control"."session_content_grants" SET "state" = 'revoked', "updated_at" = now()
		WHERE "tenant_id" = OLD."id" AND "state" NOT IN ('revoked');
	UPDATE "control"."session_content_namespaces" SET "status" = 'purge_pending', "updated_at" = now()
		WHERE "tenant_id" = OLD."id" AND "status" = 'active';
	INSERT INTO "control"."session_content_purge_jobs" ("purge_job_id", "namespace_id", "scope", "state")
		SELECT 'purge-' || md5("namespace_id" || clock_timestamp()::text), "namespace_id", 'namespace', 'pending'
		FROM "control"."session_content_namespaces" WHERE "tenant_id" = OLD."id" AND "status" = 'purge_pending';
	INSERT INTO "control"."session_content_tombstones" ("tombstone_id", "kind", "public_id", "tenant_id", "reason")
		VALUES ('tombstone-tenant-' || md5(OLD."id" || clock_timestamp()::text), 'tenant', OLD."id", OLD."id", 'tenant offboarded with D2 state')
		ON CONFLICT DO NOTHING;
	RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_content_fence_tenant_delete_trigger" ON "public"."tenants";
--> statement-breakpoint
CREATE TRIGGER "session_content_fence_tenant_delete_trigger" BEFORE DELETE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "control"."session_content_fence_tenant_delete"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_content_fence_user_delete_trigger" ON "public"."users";
--> statement-breakpoint
CREATE TRIGGER "session_content_fence_user_delete_trigger" BEFORE DELETE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "control"."session_content_fence_user_delete"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_content_fence_workspace_delete_trigger" ON "public"."workspaces";
--> statement-breakpoint
CREATE TRIGGER "session_content_fence_workspace_delete_trigger" BEFORE DELETE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "control"."session_content_fence_workspace_delete"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "session_content_fence_tenant_offboard_trigger" ON "public"."tenants";
--> statement-breakpoint
CREATE TRIGGER "session_content_fence_tenant_offboard_trigger" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'offboarded') EXECUTE FUNCTION "control"."session_content_fence_tenant_offboard"();
