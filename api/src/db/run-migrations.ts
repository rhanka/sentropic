import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { pool } from './client';
import { installArtifactPackageAssets } from '../services/artifacts/host-storage';

/**
 * Heal drifted databases where migration metadata is ahead of the actual settings schema.
 * This keeps user-scoped settings queries stable even when legacy snapshots are restored.
 */
async function reconcileSettingsUserScopeSchema(db: ReturnType<typeof drizzle>): Promise<void> {
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
 * Apply the `control` schema migration stream.
 *
 * The control schema hosts internal infrastructure tables (ARCH-14 event-spine):
 * `control.event_outbox`, future `control.event_audit`, etc.
 *
 * Applied AFTER the public migration stream to respect boot ordering.
 * The `CREATE SCHEMA IF NOT EXISTS control` is the very first control migration.
 */
async function runControlMigrations(db: ReturnType<typeof drizzle>): Promise<void> {
  // Drizzle's migrator tracks applied migrations in its own _drizzle table.
  // For the control stream we use a dedicated table name to avoid collisions.
  await migrate(db, {
    migrationsFolder: './drizzle/control',
    migrationsTable: '__drizzle_control_migrations',
    migrationsSchema: 'public',
  });
}

/**
 * Run database migrations (idempotent)
 *
 * This function applies all pending migrations from the drizzle folder.
 * It's safe to call multiple times as migrations are idempotent.
 *
 * @throws Error if migrations fail
 */
export async function runMigrations(migrationPool: Pool = pool): Promise<void> {
  const client = await migrationPool.connect();
  try {
    // Retain the lock-owning connection across Drizzle's stream transactions.
    await client.query(`SELECT pg_advisory_lock(hashtext('sentropic:api-migrations'))`);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    await reconcileSettingsUserScopeSchema(db);
    await runControlMigrations(db);
    await installArtifactPackageAssets(client);
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext('sentropic:api-migrations'))`);
      client.release();
    } catch (error) {
      // An uncertain unlock must never return a potentially locked session to the pool.
      client.release(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
