import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { pool } from './client';
import { installArtifactPackageAssets } from '../services/artifacts/host-storage';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { A4_CONTROL_MIGRATION_TIMESTAMP, loadAppCmCutoverConfiguration,
  loadEmptyAppCmCutoverConfiguration } from '../services/identity/cm-cutover-config';
import { importAppCmIdentityInTransaction } from '../services/identity/cm-cutover-import';
import { a4IdentitySourceTables } from '../services/identity/cm-import-source';

/**
 * Heal drifted databases where migration metadata is ahead of the actual settings schema.
 * This keeps user-scoped settings queries stable even when legacy snapshots are restored.
 *
 * Lot A4: control migration 0015 drops `public.users`; from then on the settings
 * user-scope FK references the cluster-mesh account table
 * `cm_identity.identity_user_accounts` (same ids, migrated by 0015).
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
/** Lock-free legacy presence probe (same table set as the import reader): the full
 *  `readA4IdentitySource` fences writers with LOCK TABLE, which is only legal
 *  inside the import transaction.
 *
 *  Deterministic migration seeds are not operator identity: the `sentropic`
 *  bootstrap tenant (0031_tenancy_spine.sql) and the zero-UUID admin workspace
 *  (0012_aberrant_swarm.sql) exist on every fresh database and are migrated
 *  faithfully by the import itself. Any other row requires the checkpoint. */
const SEEDED_TENANT_ID = 'sentropic';
const SEEDED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
async function hasLegacyIdentityRows(client: PoolClient): Promise<boolean> {
  for (const table of a4IdentitySourceTables) {
    if (table === 'tenants') {
      const extra = await client.query(`SELECT 1 FROM public.tenants WHERE id <> $1 LIMIT 1`, [SEEDED_TENANT_ID]);
      if (extra.rows.length > 0) return true;
      continue;
    }
    if (table === 'workspaces') {
      const extra = await client.query(`SELECT 1 FROM public.workspaces WHERE id <> $1 LIMIT 1`, [SEEDED_WORKSPACE_ID]);
      if (extra.rows.length > 0) return true;
      continue;
    }
    const probe = await client.query(`SELECT 1 FROM public.${table} LIMIT 1`);
    if (probe.rows.length > 0) return true;
  }
  return false;
}

/** Fresh databases import an empty source without an operator checkpoint; any legacy
 *  row requires the checkpoint (fail-closed). */
async function loadIdentityImportConfiguration(migrationClient: PoolClient | undefined) {
  if (!migrationClient) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  if (!process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE) {
    if (!await hasLegacyIdentityRows(migrationClient)) return loadEmptyAppCmCutoverConfiguration();
  }
  return loadAppCmCutoverConfiguration();
}

export async function runControlMigrations(db: NodePgDatabase, migrationsFolder = './drizzle/control', migrationClient?: PoolClient): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  const journalBefore = await db.execute(sql`SELECT to_regclass('public.__drizzle_control_migrations') AS relation`);
  const appliedBefore = journalBefore.rows[0].relation === null ? [] : (await db.execute(
    sql`SELECT created_at FROM public.__drizzle_control_migrations WHERE created_at = ${A4_CONTROL_MIGRATION_TIMESTAMP}`)).rows;
  const needsIdentityImport = migrations.some(migration => migration.folderMillis === A4_CONTROL_MIGRATION_TIMESTAMP)
    && appliedBefore.length === 0;
  if (needsIdentityImport && !migrationClient) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  // Files, keys and immutable policy are loaded before a transaction/store handle exists.
  const identityConfig = needsIdentityImport ? await loadIdentityImportConfiguration(migrationClient) : undefined;
  try {
  // Reserved branches can arrive in either order. A timestamp frontier alone loses earlier slots.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sentropic:control-migrations'))`);
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
      if (migration.folderMillis === A4_CONTROL_MIGRATION_TIMESTAMP) {
        if (!migrationClient || !identityConfig) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
        const bound = await tx.execute(sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS xid`);
        const host = await migrationClient.query('SELECT pg_backend_pid() AS pid, txid_current()::text AS xid');
        if (bound.rows[0].pid !== host.rows[0].pid || bound.rows[0].xid !== host.rows[0].xid) {
          throw new IdentityCustodyErrorV1('identity_transaction_unbound');
        }
        // Drizzle's transaction and the CM binding use this same connection and rollback boundary.
        await importAppCmIdentityInTransaction(migrationClient, identityConfig);
      }
      for (const statement of migration.sql) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO public.__drizzle_control_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
  }, { isolationLevel: 'serializable', accessMode: 'read write' });
  } finally { identityConfig?.dispose(); }
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
    await runControlMigrations(db, './drizzle/control', client);
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
