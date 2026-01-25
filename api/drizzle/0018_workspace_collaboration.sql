-- Workspace collaboration (Lot 1):
-- - Add workspace_memberships table for multi-user workspace sharing
-- - Add hidden_at column to workspaces for hide/unhide functionality
-- - Remove UNIQUE constraint from owner_user_id (allow multiple workspaces per user)
-- - Remove share_with_admin column (replaced by membership-based access)
-- - Data migration: create admin memberships for existing workspace owners

-- 1) Create workspace_memberships table
CREATE TABLE IF NOT EXISTS "workspace_memberships" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memberships_workspace_id_user_id_unique" ON "workspace_memberships" USING btree ("workspace_id","user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workspace_memberships_workspace_id_idx" ON "workspace_memberships" USING btree ("workspace_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workspace_memberships_user_id_idx" ON "workspace_memberships" USING btree ("user_id");
--> statement-breakpoint

-- 2) Add hidden_at column to workspaces
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp;
--> statement-breakpoint

-- 3) Remove UNIQUE constraint from owner_user_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspaces_owner_user_id_unique'
    AND conrelid = 'workspaces'::regclass
  ) THEN
    ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_owner_user_id_unique";
  END IF;
END $$;
--> statement-breakpoint

-- 4) Remove share_with_admin column
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "share_with_admin";
--> statement-breakpoint

-- 5) Data migration: create admin memberships for existing workspace owners
INSERT INTO "workspace_memberships" ("workspace_id", "user_id", "role", "created_at")
SELECT 
  "id" AS "workspace_id",
  "owner_user_id" AS "user_id",
  'admin' AS "role",
  "created_at"
FROM "workspaces"
WHERE "owner_user_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_memberships"
    WHERE "workspace_memberships"."workspace_id" = "workspaces"."id"
      AND "workspace_memberships"."user_id" = "workspaces"."owner_user_id"
  )
ON CONFLICT ("workspace_id", "user_id") DO NOTHING;

--> statement-breakpoint

-- 6) Lot 2: object edition locks (soft locks with TTL)
CREATE TABLE IF NOT EXISTS "object_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"locked_by_user_id" text NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"unlock_requested_at" timestamp,
	"unlock_requested_by_user_id" text,
	"unlock_request_message" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "object_locks" ADD CONSTRAINT "object_locks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "object_locks" ADD CONSTRAINT "object_locks_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "object_locks" ADD CONSTRAINT "object_locks_unlock_requested_by_user_id_users_id_fk" FOREIGN KEY ("unlock_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "object_locks_workspace_object_unique" ON "object_locks" USING btree ("workspace_id","object_type","object_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "object_locks_workspace_id_idx" ON "object_locks" USING btree ("workspace_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "object_locks_expires_at_idx" ON "object_locks" USING btree ("expires_at");

