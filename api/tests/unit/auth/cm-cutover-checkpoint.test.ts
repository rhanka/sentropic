import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCmCutoverCheckpoint, cmCutoverCheckpointReceipt } from '../../../src/services/identity/cm-cutover-checkpoint';

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('A4 D11 protected checkpoint', () => {
  it('should refuse absent checkpoint evidence before authorizing a data migration', async () => {
    await expect(loadCmCutoverCheckpoint(undefined, { mappingSha256: '', identityAssetSha256: '', connectorAssetSha256: '' }))
      .rejects.toThrow('identity_import_invalid');
  });

  it('should verify the snapshot and asset digests while retaining only evidence references in the durable receipt', async () => {
    directory = await mkdtemp(join(tmpdir(), 'a4-checkpoint-'));
    const path = join(directory, 'checkpoint.json'), snapshot = join(directory, 'snapshot');
    await writeFile(snapshot, 'synthetic backup', { mode: 0o600 });
    const expected = { mappingSha256: 'a'.repeat(64), identityAssetSha256: 'b'.repeat(64), connectorAssetSha256: 'c'.repeat(64) };
    const input = { format: 'app-cm-identity-cutover/1', purpose: 'rehearsal', candidateCommit: 'a'.repeat(40),
      sourceSnapshotPath: snapshot, sourceSnapshotRef: 'snapshot-ref',
      sourceSnapshotDigest: createHash('sha256').update('synthetic backup').digest('hex'), remoteSnapshotRef: 'remote-snapshot-ref',
      remoteSnapshotPath: snapshot, remoteSnapshotDigest: createHash('sha256').update('synthetic backup').digest('hex'),
      ...expected, writerFenceRef: 'fence-ref', legacyWritersStopped: true, remoteFileWriterStopped: true,
      rollbackCheckpointRef: 'rollback-ref', rollbackLimitsRef: 'limits-ref', sourceMetadataDispositionRef: 'metadata-ref',
      rehearsalReceiptRef: null };
    await writeFile(path, JSON.stringify(input), { mode: 0o600 });
    const checkpoint = await loadCmCutoverCheckpoint(path, expected);
    expect(cmCutoverCheckpointReceipt(checkpoint)).not.toHaveProperty('sourceSnapshotPath');
    await writeFile(snapshot, 'changed backup');
    await expect(loadCmCutoverCheckpoint(path, expected)).rejects.toThrow('identity_import_invalid');
  });
});
