import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptHandoff, candidateDigest, HANDOFF_LIFETIME_MS, sealHandoff, verifyReceipt,
  type CandidateFile, type HandoffReceipt, type HostLedger,
} from '../../../src/services/artifacts/live/handoff';

const builder = generateKeyPairSync('ed25519'); const host = generateKeyPairSync('ed25519');
const files: CandidateFile[] = [{ path: 'index.html', bytes: Buffer.from('<p>B</p>') }, { path: 'assets/a.js', bytes: Buffer.from('1') }];
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l'.repeat(64), descriptorDigest: 'd'.repeat(64),
  builderImageDigest: `sha256:${'i'.repeat(64)}`, nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: { VITE_ARTIFACT_MODE: 'h' } };
const claims = (over: Record<string, unknown> = {}) => ({ scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1',
  kind: 'explicit' as const, runId: 'run-1', attempt: 1, generation: 1, commitSha: tuple.commitSha, treeSha: tuple.treeSha,
  tuple, candidateDigest: candidateDigest(files), expectedReleaseId: 'release-A', ...over });
function host$(now = 1_000) {
  const receipts = new Map<string, HandoffReceipt>();
  const ledger: HostLedger = { find: async job => receipts.get(job),
    async transaction(job, work) { const done = await work(); receipts.set(job, done); return done; } };
  const publish = vi.fn(async (_claims, uploaded: readonly CandidateFile[]) =>
    ({ releaseId: 'release-B', manifestDigest: 'm'.repeat(64), storedDigest: candidateDigest(uploaded) }));
  const options = { scopeId: 'scope-a', builderKey: builder.publicKey, receiptKey: host.privateKey, now: () => now,
    ledger, expect: vi.fn(async () => true), publish };
  return { options, publish, receipts };
}
const seal = (over = {}, key = builder.privateKey, at = 1_000) => sealHandoff(claims(over), key, at);

describe('SG4b two-step handoff (A-LIVE 8.4)', () => {
  it('builder seals, host commits once and returns a receipt the builder verifies', async () => {
    const { options, publish } = host$(); const handoff = seal();
    const receipt = await acceptHandoff(options, handoff, files);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({ releaseId: 'release-B', jobId: 'job-1', candidateDigest: handoff.claims.candidateDigest });
    expect(() => verifyReceipt(receipt, host.publicKey, handoff.claims)).not.toThrow();
    expect(handoff.claims.expiresAt - handoff.claims.sealedAt).toBe(HANDOFF_LIFETIME_MS);
  });
  it('a network retry after committed success returns the stored receipt, even after expiry', async () => {
    const h = host$(); const handoff = seal();
    const first = await acceptHandoff(h.options, handoff, files);
    h.options.now = () => 1_000 + HANDOFF_LIFETIME_MS + 1;
    expect(await acceptHandoff(h.options, handoff, files)).toEqual(first);
    expect(h.publish).toHaveBeenCalledTimes(1);
  });
  it('refuses an unauthenticated producer and any tampered claim', async () => {
    const other = generateKeyPairSync('ed25519');
    await expect(acceptHandoff(host$().options, seal({}, other.privateKey), files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    const tampered = seal(); tampered.claims.commitSha = 'e'.repeat(40);
    await expect(acceptHandoff(host$().options, tampered, files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
  });
  it('expires 10 minutes after sealing; build code cannot renew it', async () => {
    const h = host$(1_000 + HANDOFF_LIFETIME_MS - 1);
    await expect(acceptHandoff(h.options, seal(), files)).resolves.toBeDefined();
    const late = host$(1_000 + HANDOFF_LIFETIME_MS);
    await expect(acceptHandoff(late.options, seal(), files)).rejects.toMatchObject({ code: 'handoff_expired' });
    expect(late.publish).not.toHaveBeenCalled();
  });
  it('is single-use per job: another run, attempt or candidate is a replay', async () => {
    const h = host$(); await acceptHandoff(h.options, seal(), files);
    for (const over of [{ runId: 'run-2' }, { attempt: 2 }, { candidateDigest: candidateDigest([files[0]]) }]) {
      await expect(acceptHandoff(h.options, seal(over), files)).rejects.toMatchObject({ code: 'handoff_replayed' });
    }
    expect(h.publish).toHaveBeenCalledTimes(1);
  });
  it('refuses a foreign scope and anything the host state does not expect', async () => {
    await expect(acceptHandoff(host$().options, seal({ scopeId: 'scope-b' }), files)).rejects.toMatchObject({ code: 'handoff_mismatch' });
    const h = host$(); h.options.expect.mockResolvedValueOnce(false);
    await expect(acceptHandoff(h.options, seal(), files)).rejects.toMatchObject({ code: 'handoff_mismatch' });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it('refuses missing mandatory evidence and a tuple for another commit', async () => {
    await expect(acceptHandoff(host$().options, seal({ tuple: { ...tuple, builderImageDigest: '' } }), files))
      .rejects.toMatchObject({ code: 'handoff_evidence_missing' });
    await expect(acceptHandoff(host$().options, seal({ commitSha: 'f'.repeat(40) }), files))
      .rejects.toMatchObject({ code: 'handoff_evidence_missing' });
  });
  it('refuses uploaded or stored bytes that differ from the sealed candidate, and stores nothing', async () => {
    const h = host$();
    await expect(acceptHandoff(h.options, seal(), [files[0], { path: 'assets/a.js', bytes: Buffer.from('2') }]))
      .rejects.toMatchObject({ code: 'candidate_bytes_mismatch' });
    h.publish.mockResolvedValueOnce({ releaseId: 'release-B', manifestDigest: 'm', storedDigest: 'repacked' });
    await expect(acceptHandoff(h.options, seal(), files)).rejects.toMatchObject({ code: 'candidate_bytes_mismatch' });
    expect(h.receipts.size).toBe(0);
  });
  it('bounds the candidate: 255 files, safe paths, no duplicates', () => {
    const many = Array.from({ length: 256 }, (_, i) => ({ path: `f${i}`, bytes: Buffer.from('x') }));
    expect(() => candidateDigest(many.slice(0, 255))).not.toThrow();
    expect(() => candidateDigest(many)).toThrow('candidate_invalid');
    for (const path of ['../x', '/x', 'a//b', 'a\\b', '.', '']) expect(() => candidateDigest([{ path, bytes: Buffer.from('') }])).toThrow('candidate_invalid');
    expect(() => candidateDigest([files[0], files[0]])).toThrow('candidate_invalid');
  });
  it('the builder refuses a receipt signed by another key or for another handoff', async () => {
    const handoff = seal(); const receipt = await acceptHandoff(host$().options, handoff, files);
    expect(() => verifyReceipt(receipt, builder.publicKey, handoff.claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt({ ...receipt, releaseId: 'release-X' }, host.publicKey, handoff.claims)).toThrow('receipt_invalid');
    expect(() => verifyReceipt(receipt, host.publicKey, seal({ runId: 'run-9' }).claims)).toThrow('receipt_invalid');
  });
});
