import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { ArtifactBuildTuple } from '../server/build-contract.js';
import { LiveHostError } from './errors.js';
import { assertSigner, ed25519, liveKeyId, type KeyResolver, type SigningKey } from './keys.js';

/** A-LIVE §8.4 two-step SG4b handoff. Step 1: the trusted builder seals the candidate into a single-use Ed25519
 * authorization. Step 2: the host verifies it, commits release/index/receipt/baseline in ONE transaction and signs a
 * receipt. No private key or publication credential enters a worker pod. */
export const HANDOFF_LIFETIME_MS = 600_000;
export interface HandoffClaims {
  v: 1; kid: string; scopeId: string; artifactId: string; jobId: string; kind: 'explicit' | 'idle'; runId: string;
  attempt: number; generation: number; commitSha: string; treeSha: string; tuple: ArtifactBuildTuple;
  candidateDigest: string; expectedReleaseId: string | null; nonce: string; sealedAt: number; expiresAt: number;
}
export type HandoffInput = Omit<HandoffClaims, 'v' | 'kid' | 'nonce' | 'sealedAt' | 'expiresAt'>;
export interface Handoff { claims: HandoffClaims; signature: string }
export interface HandoffReceipt {
  v: 1; kid: string; nonce: string; scopeId: string; artifactId: string; jobId: string; runId: string; attempt: number;
  commitSha: string; candidateDigest: string; releaseId: string; manifestDigest: string; committedAt: number; signature: string;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const encode = (value: Json): string => Array.isArray(value) ? `[${value.map(encode).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode(value[key])}`).join(',')}}`
    : JSON.stringify(value);
/** Sorted-key JSON of the JSON-normalized value, so the signed bytes survive a JSON round trip. */
const canonical = (value: unknown) => encode(JSON.parse(JSON.stringify(value)) as Json);
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const HANDOFF_TAG = 'sentropic.sg4b.handoff.v1\n'; const RECEIPT_TAG = 'sentropic.sg4b.receipt.v1\n';
export const signed = (tag: string, body: object, key: KeyObject) => sign(null, Buffer.from(tag + canonical(body)), key).toString('base64url');
export function valid(tag: string, body: object, signature: unknown, key: KeyObject | undefined) {
  try {
    return ed25519(key, 'public') && typeof signature === 'string'
      && verify(null, Buffer.from(tag + canonical(body)), key, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
/** Deterministic: a resend for the same attempt reuses the nonce, even under a rotated key, and reads the committed receipt. */
const nonceOf = (c: HandoffInput) =>
  sha(canonical([c.scopeId, c.artifactId, c.jobId, c.runId, c.attempt, c.generation, c.commitSha, c.candidateDigest]));
/** Host ledger key: one consumption per job. */
export const jobKey = (c: Pick<HandoffClaims, 'scopeId' | 'artifactId' | 'jobId'>) => sha(canonical([c.scopeId, c.artifactId, c.jobId]));

export function sealHandoff(input: HandoffInput, signer: SigningKey, now: number): Handoff {
  assertSigner(signer);
  const claims: HandoffClaims = { v: 1, kid: signer.kid, ...input, nonce: nonceOf(input), sealedAt: now, expiresAt: now + HANDOFF_LIFETIME_MS };
  return { claims, signature: signed(HANDOFF_TAG, claims, signer.key) };
}
const RECEIPT_FIELDS = ['nonce', 'scopeId', 'artifactId', 'jobId', 'runId', 'attempt', 'commitSha', 'candidateDigest'] as const;
/** Builder side: the receipt is signed by a known host key (by its kid) and binds this exact handoff. */
export function verifyReceipt(receipt: HandoffReceipt, receiptKeys: KeyResolver, expected: HandoffClaims): void {
  if (!record(receipt) || !liveKeyId(receipt.kid)) throw new LiveHostError('receipt_invalid');
  const { signature, ...body } = receipt;
  if (!valid(RECEIPT_TAG, body, signature, receiptKeys(receipt.kid)) || receipt.v !== 1 || !text(receipt.releaseId)
    || !text(receipt.manifestDigest) || !Number.isSafeInteger(receipt.committedAt)
    || RECEIPT_FIELDS.some(field => receipt[field] !== expected[field])) throw new LiveHostError('receipt_invalid');
}

/** Host side (module-internal, not re-exported by the subpath). */
export const handoffAuthentic = (handoff: Handoff, builderKeys: KeyResolver) => record(handoff) && record(handoff.claims)
  && handoff.claims.v === 1 && liveKeyId(handoff.claims.kid)
  && valid(HANDOFF_TAG, handoff.claims, handoff.signature, builderKeys(handoff.claims.kid));
const TUPLE = ['commitSha', 'treeSha', 'lockfileDigest', 'descriptorDigest', 'builderImageDigest', 'nodeVersion', 'npmVersion'] as const;
const TEXT = ['scopeId', 'artifactId', 'jobId', 'runId', 'commitSha', 'treeSha', 'candidateDigest'] as const;
/** Mandatory A-LIVE §8.4 evidence join, and a nonce derived from these exact claims. */
export function handoffEvidence(c: HandoffClaims): boolean {
  const tuple: unknown = c.tuple;
  return TEXT.every(field => text(c[field])) && count(c.attempt) && count(c.generation) && (c.kind === 'explicit' || c.kind === 'idle')
    && (c.expectedReleaseId === null || text(c.expectedReleaseId)) && Number.isSafeInteger(c.sealedAt) && Number.isSafeInteger(c.expiresAt)
    && c.nonce === nonceOf(c) && record(tuple) && TUPLE.every(field => text(tuple[field])) && record(tuple.publicEnvHashes)
    && Object.values(tuple.publicEnvHashes).every(text) && tuple.commitSha === c.commitSha && tuple.treeSha === c.treeSha;
}
export function signReceipt(body: Omit<HandoffReceipt, 'signature'>, signer: SigningKey): HandoffReceipt {
  return { ...body, signature: signed(RECEIPT_TAG, body, signer.key) };
}
