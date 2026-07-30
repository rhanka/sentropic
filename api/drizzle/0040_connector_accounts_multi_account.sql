-- Allow document connector account identities for Google Drive and Gmail.
DO $$ BEGIN
 ALTER TABLE "document_connector_accounts" DROP CONSTRAINT "document_connector_accounts_provider_check";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_connector_accounts" ADD CONSTRAINT "document_connector_accounts_provider_check" CHECK ("document_connector_accounts"."provider" IN ('google_drive', 'gmail'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "document_connector_accounts_workspace_user_provider_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_connector_accounts_workspace_user_provider_subject_unique" ON "document_connector_accounts" USING btree ("workspace_id","user_id","provider","account_subject");
