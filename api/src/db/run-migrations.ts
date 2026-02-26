import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { db } from './client';

/**
 * Heal drifted databases where migration metadata is ahead of the actual settings schema.
 * This keeps user-scoped settings queries stable even when legacy snapshots are restored.
 */
async function reconcileSettingsUserScopeSchema(): Promise<void> {
  await db.execute(sql.raw('ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_pkey";'));
  await db.execute(sql.raw('ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "user_id" text;'));
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE "settings"
      ADD CONSTRAINT "settings_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `));
  await db.execute(
    sql.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS "settings_global_key_unique" ON "settings" USING btree ("key") WHERE "user_id" IS NULL;',
    ),
  );
  await db.execute(
    sql.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS "settings_user_key_unique" ON "settings" USING btree ("user_id","key") WHERE "user_id" IS NOT NULL;',
    ),
  );
  await db.execute(sql.raw('CREATE INDEX IF NOT EXISTS "settings_key_idx" ON "settings" USING btree ("key");'));
  await db.execute(sql.raw('CREATE INDEX IF NOT EXISTS "settings_user_id_idx" ON "settings" USING btree ("user_id");'));
  await db.execute(
    sql.raw('CREATE INDEX IF NOT EXISTS "settings_user_key_idx" ON "settings" USING btree ("user_id","key");'),
  );
}

/**
 * Run database migrations (idempotent)
 * 
 * This function applies all pending migrations from the drizzle folder.
 * It's safe to call multiple times as migrations are idempotent.
 * 
 * @throws Error if migrations fail
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
  await reconcileSettingsUserScopeSchema();
}
