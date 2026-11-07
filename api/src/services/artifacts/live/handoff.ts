import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { ArtifactBuildTuple } from '@sentropic/artifacts/server/build-contract';

/** A-LIVE §8.4 two-step SG4b handoff. Pure and dependency-free so the host verifier can run it as is.
 * Step 1: the trusted builder seals the candidate into a single-use Ed25519 authorization.
 * Step 2: the host verifies it, commits release/index/receipt/baseline in ONE transaction and signs a receipt.
 * Neither private key nor any publication credential enters a worker pod. */
export const HANDOFF_LIFETIME_MS = 600_000;
export type HandoffErrorCode = 'handoff_unauthenticated' | 'handoff_expired' | 'handoff_mismatch' | 'handoff_replayed'
  | 'handoff_evidence_missing' | 'candidate_invalid' | 'candidate_bytes_mismatch' | 'receipt_invalid';
export class HandoffError extends Error { constructor(readonly code: HandoffErrorCode) { super(code); } }

export interface HandoffClaims {
  v: 1; scopeId: string; artifactId: string; jobId: string; kind: 'explicit' | 'idle'; runId: string; attempt: number;
  generation: number; commitSha: string; treeSha: string; tuple: ArtifactBuildTuple; candidateDigest: string;
  expectedReleaseId: string | null; nonce: string; sealedAt: number; expiresAt: number;
}
export interface Handoff { claims: HandoffClaims; signature: string }
export interface CandidateFile { path: string; bytes: Uint8Array }
export interface HandoffReceipt {
  v: 1; nonce: string; scopeId: string; artifactId: string; jobId: string; runId: string; attempt: number;
  commitSha: string; candidateDigest: string; releaseId: string; manifestDigest: string; committedAt: number; signature: string;
}
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
const canonical = (value: Json): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, Json>)[k])}`).join(',')}}`
    : JSON.stringify(value);
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const HANDOFF_TAG = 'sentropic.sg4b.handoff.v1\n'; const RECEIPT_TAG = 'sentropic.sg4b.receipt.v1\n';
const signed = (tag: string, body: object, key: KeyObject) => sign(null, Buffer.from(tag + canonical(body as Json)), key).toString('base64url');
function valid(tag: string, body: object, signature: unknown, key: KeyObject) {
  try { return typeof signature === 'string' && verify(null, Buffer.from(tag + canonical(body as Json)), key, Buffer.from(signature, 'base64url')); }
  catch { return false; }
}
const SEGMENT = /^[A-Za-z0-9._@+~-]+$/;
const safePath = (path: string) => Buffer.byteLength(path) <= 1024 && path.split('/').every(s => SEGMENT.test(s) && s !== '.' && s !== '..');
/** Canonical candidate digest over the verified output set (G0 §2.3 candidate). Enforces the §8.3 ceilings. */
export function candidateDigest(files: readonly CandidateFile[]) {
  if (files.length < 1 || files.length > 255) throw new HandoffError('candidate_invalid');
  const seen = new Set<string>(); let total = 0;
  const entries = files.map(({ path, bytes }) => {
    if (typeof path !== 'string' || !safePath(path) || seen.has(path) || bytes.byteLength > 16_777_216) throw new HandoffError('candidate_invalid');
    seen.add(path); total += bytes.byteLength;
    return [path, bytes.byteLength, sha(bytes)] as const;
  }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (total > 67_108_864) throw new HandoffError('candidate_invalid');
  return sha(`sentropic.candidate.v1\n${canonical(entries)}`);
}
/** Deterministic: a resend for the same attempt reuses the nonce and reads the committed receipt. */
const nonceOf = (c: Omit<HandoffClaims, 'v' | 'nonce' | 'sealedAt' | 'expiresAt'>) =>
  sha(canonical([c.scopeId, c.artifactId, c.jobId, c.runId, c.attempt, c.generation, c.commitSha, c.candidateDigest]));
export const jobKey = (c: Pick<HandoffClaims, 'scopeId' | 'artifactId' | 'jobId'>) => sha(canonical([c.scopeId, c.artifactId, c.jobId]));

export function sealHandoff(input: Omit<HandoffClaims, 'v' | 'nonce' | 'sealedAt' | 'expiresAt'>, key: KeyObject, now: number): Handoff {
  const claims: HandoffClaims = { v: 1, ...input, nonce: nonceOf(input), sealedAt: now, expiresAt: now + HANDOFF_LIFETIME_MS };
  return { claims, signature: signed(HANDOFF_TAG, claims, key) };
}
export function verifyReceipt(receipt: HandoffReceipt, key: KeyObject, expected: HandoffClaims) {
  const { signature, ...body } = receipt;
  if (!valid(RECEIPT_TAG, body, signature, key) || receipt.v !== 1 || receipt.nonce !== expected.nonce
    || receipt.scopeId !== expected.scopeId || receipt.artifactId !== expected.artifactId || receipt.jobId !== expected.jobId
    || receipt.runId !== expected.runId || receipt.attempt !== expected.attempt || receipt.commitSha !== expected.commitSha
    || receipt.candidateDigest !== expected.candidateDigest) throw new HandoffError('receipt_invalid');
}

/** Host persistence. `transaction` runs `work` and stores its receipt under the job key in ONE host transaction, so a
 * failed release CAS or bytes re-read rolls back the consumption too. A concurrent winner is returned as stored. */
export interface HostLedger {
  find(jobKey: string): Promise<HandoffReceipt | undefined>;
  transaction(jobKey: string, work: () => Promise<HandoffReceipt>): Promise<HandoffReceipt>;
}
export interface AcceptOptions {
  scopeId: string; builderKey: KeyObject; receiptKey: KeyObject; now(): number; ledger: HostLedger;
  /** Host state recheck: admitted job, generation, commit/tree, expectedCurrentReleaseId, image allowlist, policy. */
  expect(claims: HandoffClaims): boolean | Promise<boolean>;
  /** Inside the host transaction: store the exact bytes, write release/index/receipt/baseline, re-read stored bytes. */
  publish(claims: HandoffClaims, files: readonly CandidateFile[]): Promise<{ releaseId: string; manifestDigest: string; storedDigest: string }>;
}
const TUPLE = ['commitSha', 'treeSha', 'lockfileDigest', 'descriptorDigest', 'builderImageDigest', 'nodeVersion', 'npmVersion'] as const;
export async function acceptHandoff(options: AcceptOptions, handoff: Handoff, files: readonly CandidateFile[]): Promise<HandoffReceipt> {
  const { claims } = handoff;
  if (!claims || claims.v !== 1 || !valid(HANDOFF_TAG, claims, handoff.signature, options.builderKey)) throw new HandoffError('handoff_unauthenticated');
  const tuple = claims.tuple;
  if (!tuple || TUPLE.some(field => typeof tuple[field] !== 'string' || !tuple[field]) || typeof tuple.publicEnvHashes !== 'object'
    || tuple.commitSha !== claims.commitSha || tuple.treeSha !== claims.treeSha) throw new HandoffError('handoff_evidence_missing');
  const job = jobKey(claims);
  const stored = await options.ledger.find(job);
  if (stored) { if (stored.nonce !== claims.nonce) throw new HandoffError('handoff_replayed'); return stored; }
  const now = options.now();
  if (now >= claims.expiresAt || claims.expiresAt - claims.sealedAt > HANDOFF_LIFETIME_MS) throw new HandoffError('handoff_expired');
  if (claims.scopeId !== options.scopeId || !await options.expect(claims)) throw new HandoffError('handoff_mismatch');
  if (candidateDigest(files) !== claims.candidateDigest) throw new HandoffError('candidate_bytes_mismatch');
  const receipt = await options.ledger.transaction(job, async () => {
    const result = await options.publish(claims, files);
    if (result.storedDigest !== claims.candidateDigest) throw new HandoffError('candidate_bytes_mismatch');
    const body = { v: 1 as const, nonce: claims.nonce, scopeId: claims.scopeId, artifactId: claims.artifactId, jobId: claims.jobId,
      runId: claims.runId, attempt: claims.attempt, commitSha: claims.commitSha, candidateDigest: claims.candidateDigest,
      releaseId: result.releaseId, manifestDigest: result.manifestDigest, committedAt: options.now() };
    return { ...body, signature: signed(RECEIPT_TAG, body, options.receiptKey) };
  });
  if (receipt.nonce !== claims.nonce) throw new HandoffError('handoff_replayed');
  return receipt;
}
