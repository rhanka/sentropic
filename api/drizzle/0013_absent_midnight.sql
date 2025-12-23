-- Tenancy for queue: each job belongs to a workspace (private-by-default).
ALTER TABLE "job_queue" ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_queue" ADD CONSTRAINT "job_queue_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
