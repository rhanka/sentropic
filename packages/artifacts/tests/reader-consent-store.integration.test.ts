/**
 * Lot 1a — consent slice on the reference Postgres adapter (design-merged
 * §1.2, §3.1): same-behavior matrix as the memory double, migration body
 * applied from `sql/reader-consent.sql`, rollback atomicity, no content in
 * events, purge leaves zero rows. Runs only under
 * `make test-artifacts-integration` (needs DATABASE_URL).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPostgresReaderConsentStore } from '../src/adapters/postgres-reader-consent.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('reader consent proof needs DATABASE_URL (make test-artifacts-integration)');
}

const SCOPE = 'scope-rc-pg';
const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const pool = new Pool({ connectionString: DATABASE_URL });
const key = (overrides = {}) => ({ storageScopeId: SCOPE, readerAccountId: 'alice',
  artifactId: ARTIFACT, scopeId: 'baskets.read', scopeVersion: 'v1', ...overrides });

beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query(readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', 'migrations', '0001_artifacts.sql'), 'utf8'));
  await pool.query(readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', 'sql', 'reader-consent.sql'), 'utf8'));
  await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, 'org-1')`, [SCOPE]);
  await pool.query(`INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
    VALUES ($1, $2, 'owner-1', 'site')`, [ARTIFACT, SCOPE]);
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.end();
});

describe('postgres reader consent store', () => {
  it('grants, finds, revokes and converges like the memory double', async () => {
    const store = createPostgresReaderConsentStore(pool);
    expect(await store.findLiveConsent(key())).toBeUndefined();
    await store.grantConsent({ consentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...key(),
      grantedAt: '2026-11-04T08:00:00.000Z', grantedVia: 'reader_screen' });
    expect(await store.findLiveConsent(key())).toMatchObject({ consentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const same = await store.grantConsent({ consentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ...key(),
      grantedAt: '2026-11-04T08:01:00.000Z', grantedVia: 'reader_screen' });
    expect(same.consentId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await store.revokeConsent(key(), 'self', '2026-11-04T09:00:00.000Z',
      { actor: 'alice', surface: 'mcp' })).toEqual({ changed: true, revokedAt: '2026-11-04T09:00:00.000Z' });
    expect(await store.findLiveConsent(key())).toBeUndefined();
    expect(await store.revokeConsent(key(), 'self', '2026-11-04T10:00:00.000Z',
      { actor: 'alice', surface: 'mcp' })).toEqual({ changed: false });
    expect(await store.findLiveConsent(key({ readerAccountId: 'bob' }))).toBeUndefined();
  });

  it('keeps audit events free of content and purges every row with the artifact', async () => {
    const store = createPostgresReaderConsentStore(pool);
    await store.grantConsent({ consentId: '99999999-9999-4999-8999-999999999999', ...key(),
      grantedAt: '2026-11-04T08:00:00.000Z', grantedVia: 'reader_screen' });
    const { rows } = await pool.query(
      `SELECT action, actor, surface FROM artifacts.reader_consent_events WHERE artifact_id = $1 ORDER BY id`, [ARTIFACT]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['action', 'actor', 'surface']);
    await store.purgeForArtifact(SCOPE, ARTIFACT);
    const remaining = await pool.query(`SELECT COUNT(*)::int AS n FROM artifacts.reader_consents`);
    expect(remaining.rows[0].n).toBe(0);
    const events = await pool.query(`SELECT COUNT(*)::int AS n FROM artifacts.reader_consent_events`);
    expect(events.rows[0].n).toBe(0);
  });
});
