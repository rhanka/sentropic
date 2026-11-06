import { chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonical, custody, sha256 } from '../../../src/scripts/cm-preprod-contract';
import { preparePreprod } from '../../../src/scripts/cm-preprod-checkpoint';
import { inspectPreprod } from '../../../src/scripts/cm-preprod-state';
import { downloadTenantBackup } from '../../../src/scripts/cm-preprod-backup';

vi.mock('../../../src/scripts/cm-preprod-contract', async original => ({
  ...await original<typeof import('../../../src/scripts/cm-preprod-contract')>(),
  custody: `/tmp/sentropic-a4-checkpoint-${process.pid}-${process.env.VITEST_WORKER_ID}`,
}));
vi.mock('../../../src/scripts/cm-preprod-state', () => ({ inspectPreprod: vi.fn() }));
vi.mock('../../../src/scripts/cm-preprod-backup', async original => ({
  ...await original<typeof import('../../../src/scripts/cm-preprod-backup')>(), downloadTenantBackup: vi.fn(),
}));
vi.mock('../../../src/services/identity/cm-email-policy', () => ({ loadCmEmailCodePolicy: () => ({ policy: {
  issuance: 'hmac-sha256', activeKeyRef: 'email-code-hmac:v1:preprod:15c2f8b66073655a', previousKeyRefs: [] }, dispose() {} }) }));
vi.mock('../../../src/services/identity/cm-deletion-options', () => ({
  loadCmDeletionOptions() {}, loadCmWorkspaceDeletionOptions() {}, loadReplicaRunOptions() {},
}));

const remote = JSON.stringify({ format: 'remote-session-projection-snapshot/1', records: [] });
const compressed = gzipSync('-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n');
const candidate = 'a'.repeat(40), hash = 'b'.repeat(64);
const request = { format: 'preprod-a4-request/1', namespace: 'sentropic-preprod', operationId: 'a4-qualification',
  candidateCommit: candidate, candidateImage: `rg.fr-par.scw.cloud/nc-reg/sentropic-api@sha256:${hash}`,
  backupTemplateSha256: hash, authorizationRef: 'track:cutover-approval', writerFenceRef: 'track:writer-fence',
  rollbackCheckpointRef: 'track:rollback', rollbackLimitsRef: 'track:limits', sourceMetadataDispositionRef: 'track:metadata',
  remoteSnapshotRef: 'custody:remote-export', remoteSnapshotDigest: sha256(remote), legacyWritersStopped: true, remoteFileWriterStopped: true };
const requestBytes = JSON.stringify(request), requestSha256 = sha256(requestBytes);
const state = { sourceContentSha256: hash, schemaSha256: hash, journalSha256: hash, remoteSnapshotDigest: sha256(remote),
  mappingSha256: hash, identityAssetSha256: hash, connectorAssetSha256: hash };
const backup = { backupSha256: sha256(compressed), backupBytes: compressed.length };
const evidence = { format: 'preprod-a4-snapshot/1', operationId: request.operationId, candidateCommit: candidate,
  candidateImage: request.candidateImage, writerFenceRef: request.writerFenceRef, requestSha256,
  ...state, ...backup, backupKey: 'pg/20261106T150000Z.sql.gz' };
const receipt = { format: 'preprod-a4-rehearsal/2', receiptRef: 'track:isolated-rehearsal', ...state,
  candidateCommit: candidate, candidateImage: request.candidateImage, applicabilityReviewRef: 'track:census-coverage-review',
  restoredBackupSha256: 'e'.repeat(64), candidateBootPassed: true, functionalAuthPassed: true,
  d11Passed: true, isolatedRestoreRef: 'tenant:isolated-restore-record' };
const client = {} as PoolClient;
const write = (name: string, bytes: string | Uint8Array) => writeFile(`${custody}/${name}`, bytes, { mode: 0o600 });
beforeEach(async () => {
  await mkdir(custody, { recursive: true, mode: 0o700 });
  await write('request.json', requestBytes); await write('remote.json', remote); await write('source.sql.gz', compressed);
  await write('snapshot.json', JSON.stringify(evidence)); await write('rehearsal.json', JSON.stringify(receipt));
  process.env.A4_CANDIDATE_COMMIT = candidate;
  vi.mocked(inspectPreprod).mockReset(); vi.mocked(inspectPreprod).mockResolvedValue(state);
  vi.mocked(downloadTenantBackup).mockReset(); vi.mocked(downloadTenantBackup).mockResolvedValue(backup);
});
afterEach(async () => { await rm(custody, { recursive: true, force: true }); delete process.env.A4_CANDIDATE_COMMIT; });

describe('real cutover checkpoint preparation', () => {
  it('should reuse reviewed isolated qualification without restoring the final rollback dump', async () => {
    expect(receipt.restoredBackupSha256).not.toBe(evidence.backupSha256);
    await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 })).resolves.toHaveProperty('checkpointSha256');
  });
  for (const field of ['candidateCommit', 'candidateImage', ...Object.keys(state)]) {
    it(`should refuse qualification drift in ${field}`, async () => {
      await write('rehearsal.json', JSON.stringify({ ...receipt, [field]: field === 'candidateCommit' ? 'c'.repeat(40)
        : field === 'candidateImage' ? request.candidateImage.replace(hash, 'c'.repeat(64)) : 'c'.repeat(64) }));
      await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 })).rejects.toThrow('rehearsal_mismatch');
      expect(await readdir(custody)).not.toContain('checkpoint.json');
    });
  }
  for (const field of ['receiptRef', 'applicabilityReviewRef', 'restoredBackupSha256', 'isolatedRestoreRef',
    'candidateBootPassed', 'functionalAuthPassed', 'd11Passed']) {
    it(`should refuse absent isolated qualification evidence ${field}`, async () => {
      const incomplete: Record<string, unknown> = { ...receipt }; delete incomplete[field];
      await write('rehearsal.json', JSON.stringify(incomplete));
      await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 })).rejects.toThrow();
      expect(await readdir(custody)).not.toContain('checkpoint.json');
    });
  }
  it('should validate every receipt and snapshot without writing in checkpoint dry-run', async () => {
    const names = await readdir(custody);
    const result = await preparePreprod(client, { phase: 'checkpoint', dryRun: true, requestSha256 });
    expect(result).toHaveProperty('checkpointSha256'); expect(await readdir(custody)).toEqual(names);
    expect(downloadTenantBackup).toHaveBeenCalledWith(evidence.backupKey, false);
  });
  it('should write a real purpose cutover checkpoint accepted by the boot loader', async () => {
    const result = await preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 });
    const path = `${custody}/checkpoint.json`, bytes = await readFile(path);
    expect(sha256(bytes)).toBe(result.checkpointSha256); expect(bytes.length).toBeLessThanOrEqual(32768);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(bytes.toString())).toMatchObject({ purpose: 'cutover', candidateCommit: candidate,
      rehearsalReceiptRef: receipt.receiptRef, sourceSnapshotDigest: backup.backupSha256 });
    await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 })).rejects.toThrow();
  });
  for (const failure of ['receipt', 'source', 'candidate', 'request', 'permissions', 'object']) {
    it(`should refuse ${failure} mismatch before creating the checkpoint`, async () => {
      if (failure === 'receipt') await write('rehearsal.json', JSON.stringify({ ...receipt, sourceContentSha256: 'f'.repeat(64) }));
      if (failure === 'source') vi.mocked(inspectPreprod).mockResolvedValue({ ...state, sourceContentSha256: 'c'.repeat(64) });
      if (failure === 'candidate') process.env.A4_CANDIDATE_COMMIT = 'c'.repeat(40);
      if (failure === 'request') await write('request.json', JSON.stringify({ ...request, writerFenceRef: 'track:changed' }));
      if (failure === 'permissions') await chmod(`${custody}/source.sql.gz`, 0o640);
      if (failure === 'object') vi.mocked(downloadTenantBackup).mockResolvedValue({ ...backup, backupSha256: hash });
      await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: false, requestSha256 })).rejects.toThrow();
      expect(await readdir(custody)).not.toContain('checkpoint.json');
    });
  }
  it('should perform no object download or write in snapshot preflight', async () => {
    await rm(`${custody}/source.sql.gz`); await rm(`${custody}/snapshot.json`);
    const names = await readdir(custody);
    await preparePreprod(client, { phase: 'snapshot', dryRun: true, requestSha256 });
    expect(downloadTenantBackup).not.toHaveBeenCalled(); expect(await readdir(custody)).toEqual(names);
  });
  it('should refuse an existing output even during dry-run', async () => {
    await write('checkpoint.json', '{}');
    await expect(preparePreprod(client, { phase: 'checkpoint', dryRun: true, requestSha256 })).rejects.toThrow('output_already_exists');
    expect(downloadTenantBackup).not.toHaveBeenCalled();
  });
  it('should refuse a source change between preflight and the tenant backup', async () => {
    await rm(`${custody}/source.sql.gz`); await rm(`${custody}/snapshot.json`);
    await expect(preparePreprod(client, { phase: 'snapshot', dryRun: false, requestSha256,
      stateSha256: 'd'.repeat(64), backupKey: evidence.backupKey })).rejects.toThrow('pre_backup_state_changed');
    expect(downloadTenantBackup).not.toHaveBeenCalled();
  });
  it('should save backup evidence only after matching the census from before the backup Job', async () => {
    await rm(`${custody}/source.sql.gz`); await rm(`${custody}/snapshot.json`);
    vi.mocked(downloadTenantBackup).mockImplementation(async (_key, copy) => {
      if (copy) await write('source.sql.gz', compressed);
      return backup;
    });
    const result = await preparePreprod(client, { phase: 'snapshot', dryRun: false, requestSha256,
      stateSha256: sha256(canonical(state)), backupKey: evidence.backupKey });
    expect(result).toHaveProperty('snapshotSha256');
    expect(JSON.parse(await readFile(`${custody}/snapshot.json`, 'utf8'))).toEqual(evidence);
    expect(await readdir(custody)).not.toContain('checkpoint.json');
  });
});
