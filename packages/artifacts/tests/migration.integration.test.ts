/**
 * L-5b — migration proof on disposable postgres (spec-v8 §9 5b).
 *
 * Applies `migrations/0001_artifacts.sql` to a fresh `artifacts` schema and
 * proves the domain constraints: stable-binding uniqueness, intent
 * kind/state guards, release FK integrity, idempotency-key uniqueness.
 * Runs only under `make test-artifacts-integration` (needs DATABASE_URL on
 * the compose network); excluded from the unit run.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('migration proof needs DATABASE_URL (make test-artifacts-integration)');
}

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0001_artifacts.sql'),
  'utf8',
);

const client = new Client({ connectionString: DATABASE_URL });

beforeAll(async () => {
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await client.query(SQL);
});

afterAll(async () => {
  await client.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await client.end();
});

describe('0001_artifacts migration', () => {
  it('creates the domain tables', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'artifacts' ORDER BY tablename`,
    );
    expect(rows.map((r: { tablename: string }) => r.tablename)).toEqual([
      'artifact_current',
      'artifacts',
      'blobs',
      'idempotency_keys',
      'object_intents',
      'releases',
      'storage_scopes',
      'uploads',
    ]);
  });

  it('enforces stable-binding uniqueness', async () => {
    await client.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('11111111-1111-4111-8111-111111111111', 'scope-1', 'owner-1', 'site')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
         VALUES ('22222222-2222-4222-8222-222222222222', 'scope-1', 'owner-1', 'site')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
    await client.query(
      `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
       VALUES ('22222222-2222-4222-8222-222222222222', 'scope-1', 'owner-2', 'site')`,
    );
  });

  it('guards intent kind/state and release integrity', async () => {
    await expect(
      client.query(
        `INSERT INTO artifacts.object_intents (id, kind) VALUES ('33333333-3333-4333-8333-333333333333', 'hack')`,
      ),
    ).rejects.toThrow(/check constraint|23514/);
    await expect(
      client.query(
        `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest)
         VALUES ('44444444-4444-4433-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'ab', '{}')`,
      ),
    ).rejects.toThrow(/foreign key|23503/);
    await client.query(
      `INSERT INTO artifacts.object_intents (id, kind, payload)
       VALUES ('33333333-3333-4333-8333-333333333333', 'commit-release', '{"a": 1}')`,
    );
    const { rows } = await client.query(
      `SELECT state FROM artifacts.object_intents WHERE id = '33333333-3333-4333-8333-333333333333'`,
    );
    expect(rows[0]?.state).toBe('pending');
  });

  it('keeps one result per idempotency key', async () => {
    await client.query(
      `INSERT INTO artifacts.idempotency_keys (key, params_hash, result)
       VALUES ('k-1', 'h-1', '{"releaseId": "r-1"}')`,
    );
    await expect(
      client.query(
        `INSERT INTO artifacts.idempotency_keys (key, params_hash, result)
         VALUES ('k-1', 'h-2', '{"releaseId": "r-2"}')`,
      ),
    ).rejects.toThrow(/duplicate key|23505/);
  });
});
