ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_pkey";
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_global_key_unique" ON "settings" USING btree ("key") WHERE "user_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_user_key_unique" ON "settings" USING btree ("user_id","key") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_key_idx" ON "settings" USING btree ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_user_id_idx" ON "settings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_user_key_idx" ON "settings" USING btree ("user_id","key");
