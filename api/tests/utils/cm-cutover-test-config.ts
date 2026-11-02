import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { env } from '../../src/config/env';
import { loadCmCutoverCheckpoint } from '../../src/services/identity/cm-cutover-checkpoint';
import { connectorCustodyAssetSha256 } from '../../src/services/identity/cm-connector-custody-values';
import { a4MappingAssetSha256 } from '../../src/services/identity/cm-import-manifest';
import { loadA4RemoteSnapshot } from '../../src/services/identity/cm-import-remote-snapshot';
import { readA4IdentitySource } from '../../src/services/identity/cm-import-source';
import { createCmTokenCustodian } from '../../src/services/identity/cm-token-custodian';

/** Synthetic isolated-database evidence, never a deployment/rehearsal receipt. */
export async function createCmCutoverTestConfiguration(client: PoolClient) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  const directory = await mkdtemp(join(tmpdir(), 'a4-import-fixture-'));
  const sessionKey = randomBytes(32), ticketKey = randomBytes(32);
  const tokens = createCmTokenCustodian({ sessionKey, ticketKey, emailCodeKeys: new Map() });
  sessionKey.fill(0); ticketKey.fill(0);
  const dispose = async () => { tokens.dispose(); await rm(directory, { recursive: true, force: true }); };
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    let source;
    try { source = await readA4IdentitySource(client); }
    finally { await client.query('ROLLBACK'); }
    const snapshotBytes = JSON.stringify({ rows: [...source.rows], inventory: source.inventory });
    const remoteBytes = JSON.stringify({ format: 'remote-session-projection-snapshot/1', records: [] });
    const sourceSnapshotPath = join(directory, 'source.json'), remoteSnapshotPath = join(directory, 'remote.json');
    await writeFile(sourceSnapshotPath, snapshotBytes, { mode: 0o600 });
    await writeFile(remoteSnapshotPath, remoteBytes, { mode: 0o600 });
    const verifier = { rpId: 'localhost', origins: ['http://localhost:5840'] };
    const identityAsset = identityCustodySchemaAssetV1('postgres');
    const mappingSha256 = a4MappingAssetSha256(verifier);
    const expected = { mappingSha256, identityAssetSha256: identityAsset.assetSha256,
      connectorAssetSha256: connectorCustodyAssetSha256 };
    const path = join(directory, 'checkpoint.json');
    await writeFile(path, JSON.stringify({
      format: 'app-cm-identity-cutover/1', purpose: 'rehearsal', candidateCommit: '0'.repeat(40),
      sourceSnapshotPath, sourceSnapshotRef: 'fixture:isolated-source',
      sourceSnapshotDigest: createHash('sha256').update(snapshotBytes).digest('hex'),
      remoteSnapshotPath, remoteSnapshotRef: 'fixture:empty-remote',
      remoteSnapshotDigest: createHash('sha256').update(remoteBytes).digest('hex'), ...expected,
      writerFenceRef: 'fixture:exclusive-test-database', legacyWritersStopped: true, remoteFileWriterStopped: true,
      rollbackCheckpointRef: 'fixture:source', rollbackLimitsRef: 'fixture:transaction-rollback',
      sourceMetadataDispositionRef: 'fixture:source', rehearsalReceiptRef: null,
    }), { mode: 0o600 });
    return { config: { checkpoint: await loadCmCutoverCheckpoint(path, expected),
      remoteSnapshot: await loadA4RemoteSnapshot(remoteSnapshotPath), verifier, identityAsset, tokens, mappingSha256,
      sourceKeyState: env.SECRET_ENCRYPTION_KEY ? 'configured-v1' : 'legacy-literal-v1', dispose() { tokens.dispose(); } }, dispose };
  } catch (error) { await dispose(); throw error; }
}
