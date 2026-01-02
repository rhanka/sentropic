-- Context documents (Chatbot Lot B):
-- Attach documents to a business context (organization/folder/usecase)
-- and store summary + processing status.

CREATE TABLE IF NOT EXISTS "context_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"context_type" text NOT NULL,
	"context_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"summary" text,
	"summary_lang" text DEFAULT 'fr',
	"prompt_id" text,
	"prompt_version_id" text,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_job_id_job_queue_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_queue"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "context_documents_workspace_id_idx" ON "context_documents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_documents_context_idx" ON "context_documents" USING btree ("context_type","context_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_documents_status_idx" ON "context_documents" USING btree ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "context_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"summary" text,
	"summary_lang" text,
	"prompt_id" text,
	"prompt_version_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "context_document_versions" ADD CONSTRAINT "context_document_versions_document_id_context_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."context_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "context_document_versions_document_id_idx" ON "context_document_versions" USING btree ("document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "context_document_versions_document_id_version_unique" ON "context_document_versions" USING btree ("document_id","version");

-- Custom SQL migration file, put your code below! --
