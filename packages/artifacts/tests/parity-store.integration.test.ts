import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createPostgresManagementUnit } from '../src/adapters/postgres-management.js';
import type { FinalizeTxClient } from '../src/server/commit/types.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = createPostgresArtifactStore(pool);
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('isolated DATABASE_URL required');
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  for (const name of ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql', '0005_terminal_controls.sql']) {
    await pool.query(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope', 'org')");
});
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE'); await pool.end(); });

describe('transactional management store', () => {
  const create = (bindingName: string) => store.ensureArtifact({ storageScopeId: 'scope', ownerId: 'alice', bindingName, profile: {} });
  it('should serialize targeted grants without replacing another principal', async () => {
    const { artifactId } = await create('shares');
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN'); await second.query('BEGIN');
      const a = createPostgresManagementUnit(first as unknown as FinalizeTxClient);
      const b = createPostgresManagementUnit(second as unknown as FinalizeTxClient);
      await a.lock(artifactId);
      const later = b.lock(artifactId);
      await a.setAccess(artifactId, 'bob', 'grant', '2026-11-01T00:00:00Z');
      await first.query('COMMIT'); await later;
      await b.setAccess(artifactId, 'carol', 'grant', '2026-11-01T00:00:00Z');
      await second.query('COMMIT');
      expect((await store.getArtifactAcl(artifactId))?.grants).toEqual([
        { principalId: 'bob', grant: 'read' }, { principalId: 'carol', grant: 'read' }]);
      expect((await store.getArtifactAcl(artifactId))?.bindingName).toBe('shares');
    } finally { first.release(); second.release(); }
  });
  it('should retain terminal identity and reject legacy restore, renew and publication', async () => {
    const { artifactId } = await create('deleted');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const unit = createPostgresManagementUnit(client as unknown as FinalizeTxClient);
      await unit.lock(artifactId); await unit.delete(artifactId, '2026-11-01T00:00:00Z');
      await client.query('COMMIT');
      expect(await store.isTerminal(artifactId)).toBe(true);
      await expect(store.setArtifactState(artifactId, 'active')).rejects.toThrow('terminal');
      await expect(create('deleted')).rejects.toThrow('gone');
      await expect(pool.query(`INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest)
        VALUES (gen_random_uuid(), $1, 'digest', '{}')`, [artifactId])).rejects.toThrow('terminal');
    } finally { client.release(); }
  });
  it('should roll back the terminal marker with its transaction', async () => {
    const { artifactId } = await create('rollback');
    const client = await pool.connect();
    await client.query('BEGIN');
    await createPostgresManagementUnit(client as unknown as FinalizeTxClient).delete(artifactId, '2026-11-01T00:00:00Z');
    await client.query('ROLLBACK'); client.release();
    expect(await store.isTerminal(artifactId)).toBe(false);
  });
});
