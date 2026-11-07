import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptHandoff, type HostLedger } from '../src/live-host/accept.js';
import { candidateDigest, type CandidateFile } from '../src/live-host/candidate.js';
import { HANDOFF_LIFETIME_MS, sealHandoff, verifyReceipt, type HandoffReceipt } from '../src/live-host/handoff.js';
import type { HostRecheckView } from '../src/live-host/recheck.js';

const builder = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey }; const host = generateKeyPairSync('ed25519');
const keys = (entries: Record<string, KeyObject>) => (kid: string) => entries[kid];
const files: CandidateFile[] = [{ path: 'index.html', bytes: Buffer.from('<p>B</p>') }, { path: 'assets/a.js', bytes: Buffer.from('1') }];
const image = `sha256:${'i'.repeat(64)}`;
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l'.repeat(64), descriptorDigest: 'd'.repeat(64),
  builderImageDigest: image, nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: { VITE_ARTIFACT_MODE: 'h' } };
const input = (over: Record<string, unknown> = {}) => ({ scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1',
  kind: 'explicit' as const, runId: 'run-1', attempt: 1, generation: 1, commitSha: tuple.commitSha, treeSha: tuple.treeSha,
  tuple, candidateDigest: candidateDigest(files), expectedReleaseId: 'release-A', ...over });
const view = (): HostRecheckView => ({ scopeId: 'scope-a', killSwitch: false, imageAllowlist: [image], currentReleaseId: 'release-A',
  headReachable: true, binding: { artifactId: 'artifact-a', state: 'build_pending', generation: 1, executor: 'sandbox',
    autoPublish: false, pendingJobId: 'job-1', pendingCommitSha: tuple.commitSha },
  job: { jobId: 'job-1', state: 'building', bindingGeneration: 1, commitSha: tuple.commitSha, expectedCurrentReleaseId: 'release-A',
    fence: { runId: 'run-1', attempt: 1 } }, policy: { ownerAuthorized: true, automaticAuthorized: false, automaticEligible: false } });
function host$(now = 1_000) {
  const receipts = new Map<string, HandoffReceipt>(); const order: string[] = [];
  const ledger: HostLedger = { find: async job => receipts.get(job), async transaction(job, work) {
    order.push('begin'); try { const done = await work(); receipts.set(job, done); order.push('commit'); return done; }
    catch (error) { order.push('rollback'); throw error; } } };
  const state = vi.fn(async () => { order.push('view'); return view(); });
  const publish = vi.fn(async (_claims: unknown, uploaded: readonly CandidateFile[]) => {
    order.push('publish'); return { releaseId: 'release-B', manifestDigest: 'm'.repeat(64), storedDigest: candidateDigest(uploaded) };
  });
  const options = { scopeId: 'scope-a', builderKeys: keys({ 'builder-1': createPublicKey(builder.key) }),
    receiptKey: { kid: 'host-1', key: host.privateKey }, now: () => now, ledger, view: state, publish };
  return { options, publish, state, receipts, order };
}
const seal = (over = {}, signer = builder) => sealHandoff(input(over), signer, 1_000);

describe('live-host SG4b host verifier (A-LIVE 8.4)', () => {
  it('rechecks inside the transaction, commits once and returns a kid-stamped receipt the builder verifies', async () => {
    const h = host$(); const handoff = JSON.parse(JSON.stringify(seal()));
    const receipt = await acceptHandoff(h.options, handoff, files);
    expect(h.order).toEqual(['begin', 'view', 'publish', 'commit']);
    expect(receipt).toMatchObject({ kid: 'host-1', releaseId: 'release-B', jobId: 'job-1', candidateDigest: handoff.claims.candidateDigest });
    expect(() => verifyReceipt(receipt, keys({ 'host-1': host.publicKey }), handoff.claims)).not.toThrow();
  });
  it('accepts old and new builder keys during a rotation overlap, refuses unknown and swapped kids', async () => {
    const next = { kid: 'builder-2', key: generateKeyPairSync('ed25519').privateKey };
    const h = host$(); h.options.builderKeys = keys({ 'builder-1': createPublicKey(builder.key), 'builder-2': createPublicKey(next.key) });
    const first = await acceptHandoff(h.options, seal(), files);
    expect(await acceptHandoff(h.options, seal({}, next), files)).toEqual(first);
    expect(h.publish).toHaveBeenCalledTimes(1);
    await expect(acceptHandoff(host$().options, seal({}, next), files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    const swapped = seal(); swapped.claims.kid = 'builder-2';
    await expect(acceptHandoff(h.options, swapped, files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
  });
  it('returns the stored receipt on a network retry, even after expiry, and is single-use per job', async () => {
    const h = host$(); const first = await acceptHandoff(h.options, seal(), files);
    h.options.now = () => 1_000 + HANDOFF_LIFETIME_MS + 1;
    expect(await acceptHandoff(h.options, seal(), files)).toEqual(first);
    for (const over of [{ runId: 'run-2' }, { attempt: 2 }, { candidateDigest: candidateDigest([files[0]]) }]) {
      await expect(acceptHandoff(h.options, seal(over), files)).rejects.toMatchObject({ code: 'handoff_replayed' });
    }
    expect(h.publish).toHaveBeenCalledTimes(1);
  });
  it('refuses an unauthenticated producer, a non-Ed25519 key, a tampered claim and malformed input', async () => {
    const other = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey };
    await expect(acceptHandoff(host$().options, seal({}, other), files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    const rsa = host$(); rsa.options.builderKeys = () => generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
    await expect(acceptHandoff(rsa.options, seal(), files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    const tampered = seal(); tampered.claims.commitSha = 'e'.repeat(40);
    await expect(acceptHandoff(host$().options, tampered, files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    for (const bad of [null, {}, { claims: null, signature: 'x' }]) {
      await expect(acceptHandoff(host$().options, bad as never, files)).rejects.toMatchObject({ code: 'handoff_unauthenticated' });
    }
  });
  it('expires 10 minutes after sealing; build code cannot renew it', async () => {
    await expect(acceptHandoff(host$(1_000 + HANDOFF_LIFETIME_MS - 1).options, seal(), files)).resolves.toBeDefined();
    const late = host$(1_000 + HANDOFF_LIFETIME_MS);
    await expect(acceptHandoff(late.options, seal(), files)).rejects.toMatchObject({ code: 'handoff_expired' });
    expect(late.publish).not.toHaveBeenCalled();
  });
  it('refuses a failed recheck with its reason, rolls back, publishes and stores nothing; a foreign scope never opens one', async () => {
    const h = host$(); h.state.mockResolvedValueOnce({ ...view(), killSwitch: true });
    await expect(acceptHandoff(h.options, seal(), files)).rejects.toMatchObject({ code: 'handoff_mismatch', reason: 'publication_paused' });
    expect(h.publish).not.toHaveBeenCalled(); expect(h.receipts.size).toBe(0); expect(h.order).toContain('rollback');
    const f = host$();
    await expect(acceptHandoff(f.options, seal({ scopeId: 'scope-b' }), files)).rejects.toMatchObject({ code: 'handoff_mismatch', reason: 'scope_mismatch' });
    expect(f.order).toEqual([]);
  });
  it('refuses missing mandatory evidence, a tuple for another commit and malformed claims', async () => {
    for (const over of [{ tuple: { ...tuple, builderImageDigest: '' } }, { commitSha: 'f'.repeat(40) }, { tuple: { ...tuple, publicEnvHashes: null } },
      { attempt: 0 }, { generation: 1.5 }, { kind: 'other' }, { expectedReleaseId: '' }, { jobId: '' }]) {
      await expect(acceptHandoff(host$().options, seal(over), files)).rejects.toMatchObject({ code: 'handoff_evidence_missing' });
    }
  });
  it('refuses uploaded or stored bytes that differ from the sealed candidate, and stores nothing', async () => {
    const h = host$();
    await expect(acceptHandoff(h.options, seal(), [files[0], { path: 'assets/a.js', bytes: Buffer.from('2') }]))
      .rejects.toMatchObject({ code: 'candidate_bytes_mismatch' });
    h.publish.mockResolvedValueOnce({ releaseId: 'release-B', manifestDigest: 'm', storedDigest: 'repacked' });
    await expect(acceptHandoff(h.options, seal(), files)).rejects.toMatchObject({ code: 'candidate_bytes_mismatch' });
    await expect(acceptHandoff(h.options, seal(), [...files, ...files])).rejects.toMatchObject({ code: 'candidate_invalid' });
    expect(h.receipts.size).toBe(0);
  });
  it('refuses a host receipt key that is not an Ed25519 private key with a valid kid', async () => {
    const h = host$(); h.options.receiptKey = { kid: 'host-1', key: host.publicKey };
    await expect(acceptHandoff(h.options, seal(), files)).rejects.toThrow(TypeError);
  });
});
