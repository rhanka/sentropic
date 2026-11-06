import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runControlMigrations, runMigrations } from '../../src/db/run-migrations';
import { A4_CONTROL_MIGRATION_TIMESTAMP } from '../../src/services/identity/cm-cutover-config';
import { getWebAuthnConfig } from '../../src/services/webauthn-config';
import { createCmCutoverTestConfiguration } from './cm-cutover-test-config';

/** Prepare an empty isolated source for the real A4 runner; never an operational receipt. */
export async function prepareCmFixtureCutover(pool: Pool, excludePriorTags: readonly string[] = []) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  const publicFolder = new URL('../../drizzle/', import.meta.url).pathname;
  const controlFolder = `${publicFolder}control`;
  const temporary = await mkdtemp(join(tmpdir(), 'a4-prior-migrations-'));
  const client = await pool.connect();
  let fixture: Awaited<ReturnType<typeof createCmCutoverTestConfiguration>> | undefined;
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: publicFolder });
    const journal = JSON.parse(await readFile(`${controlFolder}/meta/_journal.json`, 'utf8'));
    journal.entries = journal.entries.filter((entry: { when: number; tag: string }) =>
      entry.when < A4_CONTROL_MIGRATION_TIMESTAMP && !excludePriorTags.includes(entry.tag));
    await mkdir(join(temporary, 'meta'));
    await writeFile(join(temporary, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`${controlFolder}/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    await runControlMigrations(db, temporary, client);
    // Control migration 0015 drops the legacy identity tables. A second prepare on the
    // same database (idempotent re-migration) therefore finds no public.users: the
    // fixture's purpose is already fulfilled, so return a no-op dispose instead of
    // failing on the dropped table. A missing table without an applied 0015 is a
    // corrupt source and still throws.
    if ((await client.query(`SELECT to_regclass('public.users') AS relation`)).rows[0].relation === null) {
      const journal = await client.query(`SELECT to_regclass('public.__drizzle_control_migrations') AS relation`);
      const applied = journal.rows[0].relation === null ? { rowCount: 0 } : await client.query(
        `SELECT 1 FROM public.__drizzle_control_migrations WHERE created_at = $1`,
        [A4_CONTROL_MIGRATION_TIMESTAMP]);
      if ((applied.rowCount ?? 0) !== 0) return async () => {};
      throw new Error('Fresh-database fixture cannot migrate existing identities');
    }
    if ((await client.query('SELECT 1 FROM public.users LIMIT 1')).rowCount !== 0) {
      throw new Error('Fresh-database fixture cannot migrate existing identities');
    }
    const rp = getWebAuthnConfig();
    fixture = await createCmCutoverTestConfiguration(client, {
      rpId: rp.rpID, origins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin],
    });
  } finally { client.release(); await rm(temporary, { recursive: true, force: true }); }
  if (!fixture) throw new Error('Cutover fixture was not prepared');
  const prepared = fixture;
  const previous = process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE;
  process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE = prepared.checkpointPath;
  return async () => {
    if (previous === undefined) delete process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE;
    else process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE = previous;
    await prepared.dispose();
  };
}

export async function migrateCmFixtureDatabase(pool: Pool): Promise<void> {
  const dispose = await prepareCmFixtureCutover(pool);
  try { await runMigrations(pool); }
  finally { await dispose(); }
}
