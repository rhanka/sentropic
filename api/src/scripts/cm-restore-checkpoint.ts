#!/usr/bin/env tsx
/**
 * Rehearsal checkpoint for the restore SUT (`test-smoke-restore`).
 *
 * After `pg_restore` of a production backup and before the first production
 * boot, snapshot the restored legacy identity source and write a
 * `purpose: 'rehearsal'` checkpoint the fail-closed cutover gate accepts:
 * mode 0600 files, asset digests computed from this code revision, snapshot
 * digests over the bytes just written. The migration itself re-reads the live
 * rows; the snapshot files are integrity evidence, exactly like the isolated
 * test fixture (`api/tests/utils/cm-cutover-test-config.ts`).
 *
 * CI-only: invoked once by `make restore-api-sut` inside the toolbox
 * container, which shares the `cm-restore-checkpoint` volume with `api-sut`.
 * The WebAuthn verifier comes from the environment, so the caller must pass
 * the same `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` the SUT boots with.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { pool } from '../db/client';
import { connectorCustodyAssetSha256 } from '../services/identity/cm-connector-custody-values';
import { loadCmCutoverCheckpoint } from '../services/identity/cm-cutover-checkpoint';
import { a4MappingAssetSha256 } from '../services/identity/cm-import-manifest';
import { loadA4RemoteSnapshot } from '../services/identity/cm-import-remote-snapshot';
import { readA4IdentitySource } from '../services/identity/cm-import-source';
import { getWebAuthnConfig } from '../services/webauthn-config';

const directory = process.env.CM_RESTORE_CHECKPOINT_DIR ?? '/run/cm-checkpoint';
const candidateCommit = process.env.CANDIDATE_COMMIT ?? '0'.repeat(40);
if (!/^[a-f0-9]{40}$/.test(candidateCommit)) {
  console.error('CANDIDATE_COMMIT must be a 40-char lowercase hex commit SHA.');
  process.exitCode = 1;
} else {
  try {
    const rp = getWebAuthnConfig();
    const verifier = {
      rpId: rp.rpID,
      origins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin],
    };
    const client = await pool.connect();
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      let snapshotBytes: string;
      try {
        const source = await readA4IdentitySource(client);
        snapshotBytes = JSON.stringify({ rows: [...source.rows], inventory: source.inventory });
      } finally {
        await client.query('ROLLBACK');
      }
      const remoteBytes = JSON.stringify({ format: 'remote-session-projection-snapshot/1', records: [] });
      const sourceSnapshotPath = join(directory, 'source.json');
      const remoteSnapshotPath = join(directory, 'remote.json');
      await writeFile(sourceSnapshotPath, snapshotBytes, { mode: 0o600 });
      await writeFile(remoteSnapshotPath, remoteBytes, { mode: 0o600 });
      const identityAsset = identityCustodySchemaAssetV1('postgres');
      const expected = {
        mappingSha256: a4MappingAssetSha256(verifier),
        identityAssetSha256: identityAsset.assetSha256,
        connectorAssetSha256: connectorCustodyAssetSha256,
      };
      const checkpointPath = join(directory, 'checkpoint.json');
      await writeFile(checkpointPath, JSON.stringify({
        format: 'app-cm-identity-cutover/1',
        purpose: 'rehearsal',
        candidateCommit,
        sourceSnapshotPath,
        sourceSnapshotRef: 'rehearsal:restored-source',
        sourceSnapshotDigest: createHash('sha256').update(snapshotBytes).digest('hex'),
        remoteSnapshotPath,
        remoteSnapshotRef: 'rehearsal:empty-remote',
        remoteSnapshotDigest: createHash('sha256').update(remoteBytes).digest('hex'),
        ...expected,
        writerFenceRef: 'rehearsal:quiesced-restore',
        legacyWritersStopped: true,
        remoteFileWriterStopped: true,
        rollbackCheckpointRef: 'rehearsal:source-database',
        rollbackLimitsRef: 'rehearsal:transaction-rollback',
        sourceMetadataDispositionRef: 'rehearsal:source-database',
        rehearsalReceiptRef: null,
      }), { mode: 0o600 });
      // Self-check with the same loader the migration boot uses.
      await loadCmCutoverCheckpoint(checkpointPath, expected);
      await loadA4RemoteSnapshot(remoteSnapshotPath);
      console.log(`CHECKPOINT_FILE=${checkpointPath}`);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to write the restore rehearsal checkpoint:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
