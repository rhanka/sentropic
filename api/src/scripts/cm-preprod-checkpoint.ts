import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { loadCmCutoverCheckpoint, parseCmCutoverCheckpoint } from '../services/identity/cm-cutover-checkpoint';
import { loadCmEmailCodePolicy } from '../services/identity/cm-email-policy';
import { loadCmDeletionOptions, loadCmWorkspaceDeletionOptions, loadReplicaRunOptions } from '../services/identity/cm-deletion-options';
import { assertAbsent, canonical, custody, evidenceSchema, protectedBytes, protectedJson, rehearsalSchema,
  requestSchema, sha256, writeExclusive } from './cm-preprod-contract';
import { downloadTenantBackup, validateBackup } from './cm-preprod-backup';
import { inspectPreprod } from './cm-preprod-state';

export interface PreprodCommand {
  phase: 'snapshot' | 'checkpoint'; dryRun: boolean; requestSha256: string; backupKey?: string; stateSha256?: string;
}

export async function preparePreprod(client: PoolClient, command: PreprodCommand) {
  const directory = await lstat(custody);
  if (!directory.isDirectory() || (directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid?.()
    || await realpath(custody) !== custody) throw new Error('custody_invalid');
  const requestBytes = await protectedBytes(`${custody}/request.json`);
  if (sha256(requestBytes) !== command.requestSha256) throw new Error('request_changed');
  const request = requestSchema.parse(JSON.parse(requestBytes.toString('utf8')));
  if (process.env.A4_CANDIDATE_COMMIT !== request.candidateCommit) throw new Error('candidate_mismatch');
  const policy = loadCmEmailCodePolicy();
  try {
    if (policy.policy.issuance !== 'hmac-sha256'
      || policy.policy.activeKeyRef !== 'email-code-hmac:v1:preprod:15c2f8b66073655a'
      || policy.policy.previousKeyRefs.length) throw new Error('policy_mismatch');
  } finally { policy.dispose(); }
  loadCmDeletionOptions(); loadCmWorkspaceDeletionOptions(); loadReplicaRunOptions();
  const state = await inspectPreprod(client, request);
  await assertAbsent(`${custody}/checkpoint.json`);
  if (command.phase === 'snapshot') {
    await assertAbsent(`${custody}/source.sql.gz`); await assertAbsent(`${custody}/snapshot.json`);
    if (command.dryRun) return state;
    if (command.stateSha256 !== sha256(canonical(state))) throw new Error('pre_backup_state_changed');
    if (!command.backupKey) throw new Error('backup_missing');
    const backup = await downloadTenantBackup(command.backupKey, true);
    if (canonical(await inspectPreprod(client, request)) !== canonical(state)) throw new Error('source_changed');
    const evidence = evidenceSchema.parse({ format: 'preprod-a4-snapshot/1',
      operationId: request.operationId, candidateCommit: request.candidateCommit, candidateImage: request.candidateImage,
      writerFenceRef: request.writerFenceRef, requestSha256: command.requestSha256,
      ...state, ...backup, backupKey: command.backupKey });
    const bytes = JSON.stringify(evidence);
    await writeExclusive(`${custody}/snapshot.json`, bytes);
    return { ...state, snapshotSha256: sha256(bytes), ...backup };
  }
  const evidenceBytes = await protectedBytes(`${custody}/snapshot.json`);
  const evidence = evidenceSchema.parse(JSON.parse(evidenceBytes.toString('utf8')));
  if (evidence.operationId !== request.operationId || evidence.candidateCommit !== request.candidateCommit
    || evidence.candidateImage !== request.candidateImage || evidence.writerFenceRef !== request.writerFenceRef
    || evidence.requestSha256 !== command.requestSha256) throw new Error('snapshot_binding_mismatch');
  for (const [key, value] of Object.entries(state)) {
    if (evidence[key as keyof typeof evidence] !== value) throw new Error('source_changed');
  }
  const sourcePath = `${custody}/source.sql.gz`;
  const sourceMetadata = await lstat(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.mode & 0o077 || sourceMetadata.uid !== process.getuid?.()
    || await realpath(sourcePath) !== sourcePath) throw new Error('source_custody_invalid');
  const local = await validateBackup(createReadStream(sourcePath));
  const stored = await downloadTenantBackup(evidence.backupKey, false);
  if (canonical(local) !== canonical(stored) || local.backupSha256 !== evidence.backupSha256
    || local.backupBytes !== evidence.backupBytes) throw new Error('backup_changed');
  const receipt = rehearsalSchema.parse(await protectedJson(`${custody}/rehearsal.json`));
  if (receipt.evidenceSha256 !== sha256(evidenceBytes) || receipt.restoredBackupSha256 !== evidence.backupSha256) {
    throw new Error('rehearsal_mismatch');
  }
  const checkpoint = parseCmCutoverCheckpoint({ format: 'app-cm-identity-cutover/1', purpose: 'cutover',
    candidateCommit: request.candidateCommit,
    sourceSnapshotPath: sourcePath, sourceSnapshotRef: `tenant-pgbackup:${evidence.backupKey}`,
    sourceSnapshotDigest: evidence.backupSha256, remoteSnapshotPath: `${custody}/remote.json`,
    remoteSnapshotRef: request.remoteSnapshotRef, remoteSnapshotDigest: request.remoteSnapshotDigest,
    mappingSha256: state.mappingSha256, identityAssetSha256: state.identityAssetSha256,
    connectorAssetSha256: state.connectorAssetSha256, writerFenceRef: request.writerFenceRef,
    legacyWritersStopped: request.legacyWritersStopped, remoteFileWriterStopped: request.remoteFileWriterStopped,
    rollbackCheckpointRef: request.rollbackCheckpointRef, rollbackLimitsRef: request.rollbackLimitsRef,
    sourceMetadataDispositionRef: request.sourceMetadataDispositionRef, rehearsalReceiptRef: receipt.receiptRef }, state);
  const bytes = JSON.stringify(checkpoint);
  if (Buffer.byteLength(bytes) > 32768) throw new Error('checkpoint_too_large');
  if (!command.dryRun) {
    await writeExclusive(`${custody}/checkpoint.json`, bytes);
    await loadCmCutoverCheckpoint(`${custody}/checkpoint.json`, state);
  }
  return { ...state, snapshotSha256: sha256(evidenceBytes), checkpointSha256: sha256(bytes), backupSha256: evidence.backupSha256 };
}

/** Enter through the shipped API bundle so function-text mapping hashes match boot exactly. */
export async function runCmPreprodCheckpoint() {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 4096) throw new Error('command_too_large');
      chunks.push(Buffer.from(chunk));
    }
    const command = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PreprodCommand;
    if (!['snapshot', 'checkpoint'].includes(command.phase) || typeof command.dryRun !== 'boolean'
      || !/^[a-f0-9]{64}$/.test(command.requestSha256)) throw new Error('command_invalid');
    const { pool } = await import('../db/client');
    try {
      const client = await pool.connect();
      try {
        const result = await preparePreprod(client, command);
        for (const [key, digest] of Object.entries(result)) {
          if (typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)) process.stdout.write(`${key}=${digest}\n`);
        }
      } finally { client.release(); }
    } finally { await pool.end(); }
  } catch {
    // SQL/parser/S3 errors can embed credentials or rows. Never forward them.
    process.stderr.write(`failureSha256=${sha256('preprod-a4-preparation-failed')}\n`);
    process.exitCode = 1;
  }
}
