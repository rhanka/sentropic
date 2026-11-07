import type { PoolClient } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPreprod } from '../../../src/scripts/cm-preprod-verify';

const hash = 'b'.repeat(64), candidate = 'a'.repeat(40);
vi.mock('../../../src/services/webauthn-config', () => ({ getWebAuthnConfig: () => ({
  rpID: 'preprod.sentropic.sent-tech.ca', origin: 'https://preprod.sentropic.sent-tech.ca' }) }));
vi.mock('../../../src/services/identity/cm-cutover-checkpoint', () => ({ loadCmCutoverCheckpoint: async () => ({
  purpose: 'cutover', candidateCommit: 'a'.repeat(40), sourceSnapshotDigest: 'b'.repeat(64),
  remoteSnapshotDigest: 'b'.repeat(64), mappingSha256: 'b'.repeat(64), rehearsalReceiptRef: 'track:rehearsal' }) }));
vi.mock('../../../src/scripts/cm-preprod-contract', async original => ({
  ...await original<typeof import('../../../src/scripts/cm-preprod-contract')>(),
  protectedJson: async () => ({ format: 'preprod-a4-request/1', namespace: 'sentropic-preprod', operationId: 'verify-a4',
    candidateCommit: 'a'.repeat(40), candidateImage: `ghcr.io/rhanka/sentropic-api@sha256:${'b'.repeat(64)}`,
    backupTemplateSha256: 'b'.repeat(64), authorizationRef: 'track:approval', writerFenceRef: 'track:fence',
    rollbackCheckpointRef: 'track:rollback', rollbackLimitsRef: 'track:limits', sourceMetadataDispositionRef: 'track:metadata',
    remoteSnapshotRef: 'custody:remote', remoteSnapshotDigest: 'b'.repeat(64), legacyWritersStopped: true, remoteFileWriterStopped: true }),
}));
const migrationHash = readMigrationFiles({ migrationsFolder: './drizzle/control' }).find(row => row.folderMillis === 1793577600000)!.hash;
let failure = '', queries: string[] = [];
const client = { async query(sql: string) {
  queries.push(sql);
  if (sql.includes('SELECT to_regclass')) return { rows: [{ relation: sql.includes('public.users')
    ? failure === 'legacy' ? 'public.users' : null : failure === 'relation' ? null : 'present' }] };
  if (sql.includes('SELECT hash')) return { rows: failure === 'journal' ? [] : [{ hash: migrationHash }] };
  if (sql.includes("phase='pre-deletion-checkpoint'")) return { rows: [{ candidate: failure === 'candidate' ? 'wrong' : candidate,
    source: hash, rehearsal: 'track:rehearsal', remote: hash, mapping: hash, manifest: hash }] };
  if (sql.includes('receipt_json')) return { rows: [{ source: hash, manifest: hash, migration: '0015_app_cm_identity_cutover',
    verification: failure === 'receipt' ? 'false' : 'true', identities: 'true', lifecycle: 'true' }] };
  if (sql.includes("phase='post-deletion-attestation'")) return { rows: [{ dropped: failure === 'attestation' ? 'false' : 'true' }] };
  return { rows: [] };
} } as unknown as PoolClient;
beforeEach(() => { failure = ''; queries = []; });
describe('post-cutover journal and D11 verification', () => {
  it('should return only a digest after matching the journal, receipt and both D11 records', async () => {
    expect(await verifyPreprod(client)).toMatch(/^[a-f0-9]{64}$/);
    expect(queries[0]).toContain('READ ONLY'); expect(queries.at(-1)).toBe('ROLLBACK');
    expect(queries.some(sql => /\b(CREATE|INSERT|UPDATE|DELETE|DROP|COMMIT)\b/.test(sql))).toBe(false);
  });
  for (const name of ['relation', 'journal', 'candidate', 'receipt', 'attestation', 'legacy']) {
    it(`should refuse ${name} verification failure and close its read-only transaction`, async () => {
      failure = name;
      await expect(verifyPreprod(client)).rejects.toThrow(); expect(queries.at(-1)).toBe('ROLLBACK');
    });
  }
});
