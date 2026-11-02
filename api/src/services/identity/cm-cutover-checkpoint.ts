import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { invalidA4Import } from './cm-import-values';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.string().min(1);
const checkpointSchema = z.object({
  format: z.literal('app-cm-identity-cutover/1'),
  purpose: z.enum(['rehearsal', 'cutover']),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceSnapshotPath: reference, sourceSnapshotRef: reference, sourceSnapshotDigest: digest,
  remoteSnapshotRef: reference, mappingSha256: digest, identityAssetSha256: digest, connectorAssetSha256: digest,
  writerFenceRef: reference, legacyWritersStopped: z.literal(true), remoteFileWriterStopped: z.literal(true),
  rollbackCheckpointRef: reference, rollbackLimitsRef: reference, sourceMetadataDispositionRef: reference,
  rehearsalReceiptRef: reference.nullable(),
}).strict();
export type CmCutoverCheckpoint = z.infer<typeof checkpointSchema>;

/** Load privileged evidence before entering the migration transaction; never log its contents. */
export async function loadCmCutoverCheckpoint(path: string | undefined, expected: {
  mappingSha256: string; identityAssetSha256: string; connectorAssetSha256: string;
}): Promise<CmCutoverCheckpoint> {
  if (!path) return invalidA4Import();
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 32768 || (metadata.mode & 0o077) !== 0) return invalidA4Import();
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { return invalidA4Import(); }
  const result = checkpointSchema.safeParse(parsed);
  if (!result.success) return invalidA4Import();
  const value = result.data;
  if (value.mappingSha256 !== expected.mappingSha256 || value.identityAssetSha256 !== expected.identityAssetSha256
    || value.connectorAssetSha256 !== expected.connectorAssetSha256
    || (value.purpose === 'cutover' && !value.rehearsalReceiptRef)) return invalidA4Import();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(value.sourceSnapshotPath)) hash.update(chunk);
  if (hash.digest('hex') !== value.sourceSnapshotDigest) return invalidA4Import();
  return value;
}

/** Only non-secret evidence is copied to the durable D11 row. Paths stay in protected custody. */
export const cmCutoverCheckpointReceipt = (checkpoint: CmCutoverCheckpoint) => ({
  format: checkpoint.format, purpose: checkpoint.purpose, candidateCommit: checkpoint.candidateCommit,
  sourceSnapshotRef: checkpoint.sourceSnapshotRef, sourceSnapshotDigest: checkpoint.sourceSnapshotDigest,
  remoteSnapshotRef: checkpoint.remoteSnapshotRef, mappingSha256: checkpoint.mappingSha256,
  identityAssetSha256: checkpoint.identityAssetSha256, connectorAssetSha256: checkpoint.connectorAssetSha256,
  writerFenceRef: checkpoint.writerFenceRef, rollbackCheckpointRef: checkpoint.rollbackCheckpointRef,
  rollbackLimitsRef: checkpoint.rollbackLimitsRef, sourceMetadataDispositionRef: checkpoint.sourceMetadataDispositionRef,
  rehearsalReceiptRef: checkpoint.rehearsalReceiptRef,
});
