import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';

export const custody = '/run/cm-cutover';
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.string().trim().min(1).max(512).refine(value => !/placeholder|<|>|TODO|example|pending/i.test(value));
// A4 operator tiers: the request names its namespace, and the namespace fixes the format prefix,
// the email-code HMAC ring tier and the product WebAuthn verifier the import mapping is bound to.
const tiers = {
  'sentropic-preprod': { tier: 'preprod', rpId: 'preprod.sentropic.sent-tech.ca', origin: 'https://preprod.sentropic.sent-tech.ca' },
  sentropic: { tier: 'prod', rpId: 'sent-tech.ca', origin: 'https://sentropic.sent-tech.ca' },
} as const;
export type A4Namespace = keyof typeof tiers;
export const a4Tier = (namespace: A4Namespace) => tiers[namespace];
const requestFields = z.object({
  format: z.enum(['preprod-a4-request/1', 'prod-a4-request/1']), namespace: z.enum(['sentropic-preprod', 'sentropic']),
  emailCodeActiveKeyRef: z.string().regex(/^email-code-hmac:v1:(?:preprod|prod):[a-f0-9]{16}$/),
  operationId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  candidateCommit: z.string().regex(/^[a-f0-9]{40}$/).refine(value => value !== '0'.repeat(40)),
  candidateImage: z.string().regex(/^ghcr\.io\/rhanka\/sentropic-api@sha256:[a-f0-9]{64}$/),
  backupTemplateSha256: digest,
  authorizationRef: ref, writerFenceRef: ref, rollbackCheckpointRef: ref, rollbackLimitsRef: ref,
  sourceMetadataDispositionRef: ref, remoteSnapshotRef: ref, remoteSnapshotDigest: digest,
  legacyWritersStopped: z.literal(true), remoteFileWriterStopped: z.literal(true),
}).strict();
export const requestSchema = requestFields.superRefine((request, context) => {
  // Refinements may also see partial input: read every field defensively.
  const tier = Object.hasOwn(tiers, String(request.namespace)) ? a4Tier(request.namespace).tier : undefined;
  if (!tier || request.format !== `${tier}-a4-request/1` || !String(request.emailCodeActiveKeyRef).startsWith(`email-code-hmac:v1:${tier}:`)) {
    context.addIssue({ code: 'custom', message: 'tier_mismatch' });
  }
});
export type PreprodRequest = z.infer<typeof requestSchema>;

export const evidenceSchema = z.object({
  format: z.enum(['preprod-a4-snapshot/1', 'prod-a4-snapshot/1']), operationId: z.string(), candidateCommit: z.string(), candidateImage: z.string(),
  requestSha256: digest, sourceContentSha256: digest, schemaSha256: digest, journalSha256: digest, remoteSnapshotDigest: digest,
  mappingSha256: digest, identityAssetSha256: digest, connectorAssetSha256: digest,
  backupKey: z.string().regex(/^pg\/[0-9]{8}T[0-9]{6}Z\.sql\.gz$/), backupSha256: digest,
  backupBytes: z.number().int().positive(), writerFenceRef: ref,
}).strict();
export const rehearsalSchema = z.object({
  format: z.enum(['preprod-a4-rehearsal/2', 'prod-a4-rehearsal/2']), receiptRef: ref, applicabilityReviewRef: ref,
  candidateCommit: requestFields.shape.candidateCommit, candidateImage: requestFields.shape.candidateImage,
  sourceContentSha256: digest, schemaSha256: digest, journalSha256: digest, remoteSnapshotDigest: digest,
  mappingSha256: digest, identityAssetSha256: digest, connectorAssetSha256: digest,
  restoredBackupSha256: digest, candidateBootPassed: z.literal(true), functionalAuthPassed: z.literal(true),
  d11Passed: z.literal(true), isolatedRestoreRef: ref,
}).strict();

export async function protectedBytes(path: string, max = 32768): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > max || (metadata.mode & 0o077) !== 0
    || metadata.uid !== process.getuid?.() || await realpath(path) !== path) throw new Error('protected_input_invalid');
  return readFile(path);
}
export async function protectedJson(path: string): Promise<unknown> {
  return JSON.parse((await protectedBytes(path)).toString('utf8'));
}
export async function writeExclusive(path: string, bytes: string | Uint8Array): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function assertAbsent(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('output_already_exists');
}

/** Stable across physical row order; only the aggregate digest leaves custody. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])));
  return JSON.stringify(value);
}
