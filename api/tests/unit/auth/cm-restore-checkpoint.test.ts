import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../src/db/run-migrations';
import { prepareCmFixtureCutover } from '../../utils/cm-fresh-database';

// The checkpoint writer owns `pool` from the app client; route it to this test's isolated database.
const state = vi.hoisted(() => ({ pool: undefined as import('pg').Pool | undefined }));
vi.mock('../../../src/db/client', async original => ({
  ...await original<typeof import('../../../src/db/client')>(),
  pool: { connect: () => state.pool!.connect(), end: async () => {} },
}));
const { runCmRestoreCheckpoint } = await import('../../../src/scripts/cm-restore-checkpoint');

let admin: Client;
let databaseName: string;
let directory: string;
const previous = { dir: process.env.CM_RESTORE_CHECKPOINT_DIR, commit: process.env.CANDIDATE_COMMIT };

beforeEach(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  databaseName = `a4_restore_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  state.pool = new Pool({ connectionString: url.toString() });
  directory = await mkdtemp(join(tmpdir(), 'cm-restore-checkpoint-'));
  process.env.CM_RESTORE_CHECKPOINT_DIR = directory;
  process.env.CANDIDATE_COMMIT = 'a'.repeat(40);
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = undefined;
  for (const [key, value] of [['CM_RESTORE_CHECKPOINT_DIR', previous.dir], ['CANDIDATE_COMMIT', previous.commit]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await state.pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
});

/** A restored post-A4 backup: every migration applied, control 0015 journaled, legacy tables dropped. */
async function restorePostA4() {
  const dispose = await prepareCmFixtureCutover(state.pool!);
  try { await runMigrations(state.pool!); } finally { await dispose(); }
}

describe('restore rehearsal checkpoint across the A4 identity cutover', () => {
  it('should verify the cutover evidence and write no checkpoint when the backup is post-A4', async () => {
    await restorePostA4();
    expect((await state.pool!.query("SELECT to_regclass('public.users') AS relation")).rows[0].relation).toBeNull();
    await writeFile(join(directory, 'checkpoint.json'), '{}', { mode: 0o600 });
    await runCmRestoreCheckpoint();
    expect(process.exitCode).toBeUndefined();
    expect(existsSync(join(directory, 'checkpoint.json'))).toBe(false);
  });

  it.each([
    ['a legacy identity table reappears', 'CREATE TABLE public.users (id text PRIMARY KEY)'],
    ['the journaled cutover hash differs from this revision',
      "UPDATE public.__drizzle_control_migrations SET hash = 'tampered' WHERE created_at = 1793577600000"],
    ['the CM import receipt is missing', 'DROP TABLE cm_identity.identity_import_receipts CASCADE'],
  ])('should fail closed on a post-A4 backup when %s', async (_name, tamper) => {
    await restorePostA4();
    await state.pool!.query(tamper);
    await runCmRestoreCheckpoint();
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(directory, 'checkpoint.json'))).toBe(false);
  });

  it('should write a 0600 rehearsal checkpoint when the backup is pre-A4', async () => {
    const dispose = await prepareCmFixtureCutover(state.pool!);
    try { await runCmRestoreCheckpoint(); } finally { await dispose(); }
    expect(process.exitCode).toBeUndefined();
    const checkpoint = join(directory, 'checkpoint.json');
    expect(statSync(checkpoint).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(checkpoint, 'utf8'))).toMatchObject({ purpose: 'rehearsal', candidateCommit: 'a'.repeat(40) });
  });
});
