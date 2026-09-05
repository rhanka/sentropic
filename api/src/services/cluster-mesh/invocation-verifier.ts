import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

export const CLUSTER_MESH_RECEIPT_STAGES = ['transported', 'verified', 'acted'] as const;
const keySchema = z.object({
  kid: z.string().min(1), alg: z.literal('EdDSA'), crv: z.literal('Ed25519'),
  publicKeyBase64Url: z.string().min(1),
}).strict();
const evidenceSchema = z.object({
  version: z.literal('sentropic.cluster-mesh.receipt/v1'),
  kid: z.string().min(1), alg: z.literal('EdDSA'), crv: z.literal('Ed25519'),
  audience: z.string().min(1), generationId: z.string().min(1),
  invocationId: z.string().min(1), correlationId: z.string().min(1),
  method: z.string().min(1), path: z.string().min(1),
  targetRegistrationId: z.string().min(1), idempotencyKey: z.string().min(1),
  principalId: z.string().min(1), workspaceId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1), policyRevision: z.string().min(1),
  actuatorRef: z.string().min(1), custodyEpoch: z.number().int().nonnegative(),
  registrationExpiresAt: z.number().int().positive(), issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(), nonce: z.string().min(1),
  receiptStages: z.tuple([
    z.literal('transported'), z.literal('verified'), z.literal('acted'),
  ]),
}).strict();
export type ClusterMeshSignedReceiptEvidence = z.infer<typeof evidenceSchema>;
export const canonicalClusterMeshEvidence = (value: ClusterMeshSignedReceiptEvidence): Buffer =>
  Buffer.from(JSON.stringify(evidenceSchema.parse(value)));

export function createClusterMeshInvocationVerifier(input: {
  readonly publicKeysJson?: string;
  readonly audiences: readonly string[];
  readonly now?: () => Date;
  readonly isReplayed?: (invocationId: string) => Promise<boolean>;
}): VerifiedInvocationContextPort {
  const keys = new Map<string, KeyObject>();
  try {
    const records = z.array(keySchema).parse(JSON.parse(input.publicKeysJson ?? '[]'));
    if (new Set(records.map(({ kid }) => kid)).size !== records.length) throw new Error('duplicate kid');
    for (const record of records) {
      const bytes = Buffer.from(record.publicKeyBase64Url, 'base64url');
      if (bytes.toString('base64url') !== record.publicKeyBase64Url) throw new Error('invalid key encoding');
      const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('invalid key type');
      keys.set(record.kid, key);
    }
  } catch { keys.clear(); }
  const audiences = new Set(input.audiences.filter(Boolean));
  const consumed = new Map<string, number>();
  return { async verify(request) {
    const [encoded, encodedSignature, extra] = (request.authorizationEvidenceRef ?? '').split('.');
    if (!encoded || !encodedSignature || extra) throw new Error('invalid mesh evidence');
    const evidence = evidenceSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString()));
    const canonical = canonicalClusterMeshEvidence(evidence);
    const signature = Buffer.from(encodedSignature, 'base64url');
    const now = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
    if (encoded !== canonical.toString('base64url') || signature.length !== 64
      || encodedSignature !== signature.toString('base64url')
      || !audiences.has(evidence.audience) || evidence.generationId !== request.generationId
      || evidence.invocationId !== request.invocationId || evidence.correlationId !== request.correlationId
      || evidence.method !== request.method || evidence.path !== request.path
      || evidence.targetRegistrationId !== request.targetRegistrationId
      || evidence.idempotencyKey !== request.idempotencyKey
      || request.receiptStages?.join('|') !== CLUSTER_MESH_RECEIPT_STAGES.join('|')
      || evidence.expiresAt <= now || evidence.issuedAt > now + 30
      || evidence.issuedAt >= evidence.expiresAt || evidence.registrationExpiresAt < evidence.expiresAt
      || !keys.get(evidence.kid) || !verify(null, canonical, keys.get(evidence.kid)!, signature)) {
      throw new Error('mesh evidence verification failed');
    }
    for (const [nonce, expiry] of consumed) if (expiry <= now) consumed.delete(nonce);
    if (consumed.has(evidence.nonce)) throw new Error('mesh evidence replayed');
    consumed.set(evidence.nonce, evidence.expiresAt);
    if (await input.isReplayed?.(evidence.invocationId)) throw new Error('mesh evidence replayed');
    return {
      invocationId: evidence.invocationId, correlationId: evidence.correlationId,
      generationId: evidence.generationId,
      principal: { principalId: evidence.principalId, kind: 'workload', verifierId: `cluster-mesh-ed25519:${evidence.kid}` },
      workspace: { bindingId: `mesh:${evidence.workspaceId}`, workspaceId: evidence.workspaceId, revision: evidence.policyRevision },
      scopes: evidence.scopes, policyRevision: evidence.policyRevision,
      issuedAt: new Date(evidence.issuedAt * 1000).toISOString(),
      registration: {
        registrationId: evidence.targetRegistrationId, generationId: evidence.generationId,
        workspaceId: evidence.workspaceId, actuatorRef: evidence.actuatorRef,
        custodyEpoch: evidence.custodyEpoch,
        expiresAt: new Date(evidence.registrationExpiresAt * 1000).toISOString(),
      },
      custody: { custodyId: `mesh:${evidence.targetRegistrationId}`, holderPrincipalId: evidence.principalId, epoch: evidence.custodyEpoch },
    };
  } };
}
