import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { pool } from './client';
import { installArtifactPackageAssets } from '../services/artifacts/host-storage';
import { env } from '../config/env';

/**
 * Heal drifted databases where migration metadata is ahead of the actual settings schema.
 * This keeps user-scoped settings queries stable even when legacy snapshots are restored.
 *
 * Lot A4: control migration 0014 drops `public.users`; from then on the settings
 * user-scope FK references the cluster-mesh account table
 * `cm_identity.identity_user_accounts` (same ids, migrated by 0014).
 */
async function reconcileSettingsUserScopeSchema(db: NodePgDatabase): Promise<void> {
  await db.execute(sql.raw('ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_pkey";'));
  await db.execute(sql.raw('ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "user_id" text;'));
  await db.execute(sql.raw(`
    DO $$ DECLARE fk_target text; fk_column text; BEGIN
      IF to_regclass('public.users') IS NOT NULL THEN
        fk_target := '"public"."users"';
        fk_column := 'id';
      ELSE
        fk_target := '"cm_identity"."identity_user_accounts"';
        fk_column := 'user_id';
      END IF;
      EXECUTE format(
        'ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES %s(%I) ON DELETE cascade ON UPDATE no action',
        fk_target, fk_column);
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
export async function runControlMigrations(db: NodePgDatabase, migrationsFolder = './drizzle/control'): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  // Reserved branches can arrive in either order. A timestamp frontier alone loses earlier slots.
  await db.transaction(async (tx) => {
    const journal = await tx.execute(sql`SELECT to_regclass('public.__drizzle_control_migrations') AS relation`);
    if (journal.rows[0].relation === null) {
      await tx.execute(sql`CREATE TABLE public.__drizzle_control_migrations (
        id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    }
    const { rows } = await tx.execute(sql`SELECT hash, created_at FROM public.__drizzle_control_migrations WHERE created_at >= 0`);
    const applied = new Map(rows.map((row) => [Number(row.created_at), String(row.hash)]));
    for (const migration of migrations) {
      const hash = applied.get(migration.folderMillis);
      if (hash !== undefined) {
        if (hash !== migration.hash) throw new Error(`Control migration journal hash mismatch: ${migration.folderMillis}`);
        continue;
      }
      for (const statement of migration.sql) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO public.__drizzle_control_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
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
  let migrationFailure: Error | undefined;
  try {
    // Retain the lock-owning connection across Drizzle's stream transactions.
    await client.query(`SELECT pg_advisory_lock(hashtext('sentropic:api-migrations'))`);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    await reconcileSettingsUserScopeSchema(db);
    // Lot A4: control migration 0014 reads the WebAuthn RP ID from this GUC when
    // copying legacy webauthn_credentials/challenges into cm_identity.
    await client.query(`SELECT set_config('app.webauthn_rp_id', $1, false)`, [env.WEBAUTHN_RP_ID || 'localhost']);
    await runControlMigrations(db);
    await installArtifactPackageAssets(client);
  } catch (error) {
    migrationFailure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    let unlockFailure: Error | undefined;
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext('sentropic:api-migrations'))`);
    } catch (error) {
      unlockFailure = error instanceof Error ? error : new Error(String(error));
    }
    // Failed migration/cleanup sessions are destroyed, never recycled.
    client.release(unlockFailure ?? migrationFailure);
    if (unlockFailure && !migrationFailure) throw unlockFailure;
  }
}
