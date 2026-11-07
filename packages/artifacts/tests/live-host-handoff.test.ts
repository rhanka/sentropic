import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { candidateDigest } from '../src/live-host/candidate.js';
import { HANDOFF_LIFETIME_MS, jobKey, sealHandoff, signReceipt, verifyReceipt, type HandoffClaims } from '../src/live-host/handoff.js';

const seeded = (byte: number) => createPrivateKey({ format: 'der', type: 'pkcs8',
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, byte)]) });
const builder = { kid: 'builder-1', key: seeded(7) }; const host = { kid: 'host-1', key: seeded(9) };
const keys = (entries: Record<string, KeyObject>) => (kid: string) => entries[kid];
const files = [{ path: 'index.html', bytes: Buffer.from('<p>B</p>') }, { path: 'assets/a.js', bytes: Buffer.from('1') }];
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l'.repeat(64), descriptorDigest: 'd'.repeat(64),
  builderImageDigest: `sha256:${'i'.repeat(64)}`, nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: { VITE_ARTIFACT_MODE: 'h' } };
const input = (over: Record<string, unknown> = {}) => ({ scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1',
  kind: 'explicit' as const, runId: 'run-1', attempt: 1, generation: 1, commitSha: tuple.commitSha, treeSha: tuple.treeSha,
  tuple, candidateDigest: candidateDigest(files), expectedReleaseId: 'release-A', ...over });
const seal = (over = {}) => sealHandoff(input(over), builder, 1_000);
const receiptFor = (c: HandoffClaims, signer = host) => signReceipt({ v: 1, kid: signer.kid, nonce: c.nonce, scopeId: c.scopeId,
  artifactId: c.artifactId, jobId: c.jobId, runId: c.runId, attempt: c.attempt, commitSha: c.commitSha,
  candidateDigest: c.candidateDigest, releaseId: 'release-B', manifestDigest: 'm'.repeat(64), committedAt: 2_000 }, signer);
const hostKeys = keys({ 'host-1': createPublicKey(host.key) });

describe('live-host SG4b handoff, builder side (A-LIVE 8.4)', () => {
  it('pins the canonical signed form: nonce, job key and Ed25519 signature vectors', () => {
    const handoff = seal();
    expect(handoff.claims.nonce).toBe('ff876c8902a1e8c1f6dc337135d0be5c5472bc3435a931bdeaa90a58d64a4f2a');
    expect(jobKey(handoff.claims)).toBe('b360c0b7f1081f1e266371e33ca1ecc246f9b7ca3c8fcef4dedfe5847ea43db9');
    expect(handoff.signature).toBe('CcqL41SS7_wJBQ13eIbQ9P2xO_v9ZR8S-rHEEbA9wOCBPxfvQlV4amqfBBs1sZ6ZjjPv23UJFLdMyO3HaaEBDA');
    expect(handoff.claims).toMatchObject({ v: 1, kid: 'builder-1', sealedAt: 1_000, expiresAt: 1_000 + HANDOFF_LIFETIME_MS });
  });
  it('keeps the nonce across a key rotation, so a resend reads the committed receipt', () => {
    const next = { kid: 'builder-2', key: generateKeyPairSync('ed25519').privateKey };
    expect(sealHandoff(input(), next, 5_000).claims.nonce).toBe(seal().claims.nonce);
    for (const over of [{ runId: 'run-2' }, { attempt: 2 }, { generation: 2 }, { candidateDigest: 'x' }]) {
      expect(seal(over).claims.nonce).not.toBe(seal().claims.nonce);
    }
  });
  it('accepts a kid-stamped host receipt for this handoff, also after a JSON round trip', () => {
    const { claims } = seal(); const receipt = receiptFor(claims);
    expect(receipt.kid).toBe('host-1');
    expect(() => verifyReceipt(JSON.parse(JSON.stringify(receipt)), hostKeys, claims)).not.toThrow();
  });
  it('accepts old and new receipt keys during a rotation overlap and refuses an unknown or swapped kid', () => {
    const { claims } = seal(); const next = { kid: 'host-2', key: generateKeyPairSync('ed25519').privateKey };
    const overlap = keys({ 'host-1': createPublicKey(host.key), 'host-2': createPublicKey(next.key) });
    expect(() => verifyReceipt(receiptFor(claims), overlap, claims)).not.toThrow();
    expect(() => verifyReceipt(receiptFor(claims, next), overlap, claims)).not.toThrow();
    expect(() => verifyReceipt(receiptFor(claims, next), hostKeys, claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt({ ...receiptFor(claims), kid: 'host-2' }, overlap, claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt({ ...receiptFor(claims), kid: 'bad kid' }, () => createPublicKey(host.key), claims)).toThrow('receipt_invalid');
  });
  it('refuses a receipt from another key, for another handoff, altered or malformed', () => {
    const { claims } = seal(); const receipt = receiptFor(claims);
    expect(() => verifyReceipt(receipt, () => createPublicKey(builder.key), claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt(receipt, () => generateKeyPairSync('x25519').publicKey, claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt({ ...receipt, releaseId: 'release-X' }, hostKeys, claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt(receipt, hostKeys, seal({ runId: 'run-9' }).claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt(receiptFor({ ...claims, attempt: 2 }), hostKeys, claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt(null as never, hostKeys, claims)).toThrow('receipt_invalid');
  });
  it('signs only with an Ed25519 private key and a bounded kid', () => {
    expect(() => sealHandoff(input(), { kid: 'bad kid', key: builder.key }, 1)).toThrow(TypeError);
    expect(() => sealHandoff(input(), { kid: 'k'.repeat(129), key: builder.key }, 1)).toThrow(TypeError);
    expect(() => sealHandoff(input(), { kid: 'k', key: createPublicKey(builder.key) }, 1)).toThrow(TypeError);
    expect(() => sealHandoff(input(), { kid: 'k', key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }, 1)).toThrow(TypeError);
  });
});
