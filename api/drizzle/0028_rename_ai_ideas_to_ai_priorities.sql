UPDATE "workspaces" SET "type" = 'ai-priorities' WHERE "type" = 'ai-ideas';
--> statement-breakpoint
UPDATE "workspace_type_workflows" SET "workspace_type" = 'ai-priorities' WHERE "workspace_type" = 'ai-ideas';
--> statement-breakpoint
UPDATE "view_templates" SET "workspace_type" = 'ai-priorities' WHERE "workspace_type" = 'ai-ideas';
