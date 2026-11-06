import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPreprod } from '../../../src/scripts/cm-preprod-state';
import { custody, sha256, type PreprodRequest } from '../../../src/scripts/cm-preprod-contract';
import { a4SourceFieldManifest } from '../../../src/services/identity/cm-import-manifest';

vi.mock('../../../src/services/webauthn-config', () => ({ getWebAuthnConfig: () => ({
  rpID: 'preprod.sentropic.sent-tech.ca', origin: 'https://preprod.sentropic.sent-tech.ca' }) }));
const remote = '{"format":"remote-session-projection-snapshot/1","records":[]}';
const request = { remoteSnapshotDigest: sha256(remote) } as PreprodRequest;
const calls: string[] = [];
let applied = false, missing = false;
const client = { async query(sql: string, values?: string[]) {
  calls.push(sql);
  if (sql.includes('to_regclass')) return { rows: [{ relation: missing ? null : values?.[0]?.endsWith('migrations') ? values[0] : null }] };
  if (sql.includes('SELECT hash')) return { rows: applied && sql.includes('__drizzle_control')
    ? [{ hash: 'a'.repeat(64), created_at: '1793577600000' }] : [] };
  if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
  if (sql.includes('SELECT column_name')) return { rows: (a4SourceFieldManifest[values?.[0] ?? ''] ?? [])
    .map(column_name => ({ column_name })) };
  return { rows: [] };
} } as unknown as PoolClient;
beforeEach(async () => {
  calls.length = 0; applied = false; missing = false;
  await mkdir(custody, { recursive: true, mode: 0o700 });
  await writeFile(`${custody}/remote.json`, remote, { mode: 0o600 });
});
afterEach(async () => { await rm(custody, { recursive: true, force: true }); });

describe('read-only preprod source census', () => {
  it('should inspect journals and schema under READ ONLY with ACCESS SHARE locks and always roll back', async () => {
    const result = await inspectPreprod(client, request);
    expect(Object.values(result).every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls.find(sql => sql.startsWith('LOCK TABLE'))).toContain('IN ACCESS SHARE MODE');
    expect(calls.some(sql => /\b(CREATE|UPDATE|INSERT|DELETE|DROP|ALTER|COMMIT)\b/.test(sql))).toBe(false);
    expect(calls.some(sql => sql.includes('information_schema.columns'))).toBe(true);
    expect(calls.some(sql => sql.includes('pg_get_constraintdef'))).toBe(true);
  });
  it('should refuse a previously committed A4 timestamp and close the transaction', async () => {
    applied = true;
    await expect(inspectPreprod(client, request)).rejects.toThrow('already_cut_over');
    expect(calls.at(-1)).toBe('ROLLBACK');
  });
  it('should check relation existence before querying absent journal/receipt tables', async () => {
    missing = true;
    await inspectPreprod(client, request);
    expect(calls.some(sql => sql.includes('SELECT hash'))).toBe(false);
    expect(calls.filter(sql => sql.includes('to_regclass'))).toHaveLength(4);
  });
  it('should reject changed remote bytes before opening a database transaction', async () => {
    await expect(inspectPreprod(client, { ...request, remoteSnapshotDigest: 'f'.repeat(64) })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
