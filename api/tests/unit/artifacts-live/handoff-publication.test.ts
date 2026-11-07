import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptHandoff, candidateDigest, HandoffError, type CandidateFile, type HandoffReceipt } from '../../../src/services/artifacts/live/handoff';
import { createHandoffPublication, type RemoteHost } from '../../../src/services/artifacts/live/handoff-publication';
import { fixture, key } from './fixture';

const builder = generateKeyPairSync('ed25519'); const hostKeys = generateKeyPairSync('ed25519');
const files: CandidateFile[] = [{ path: 'index.html', bytes: Buffer.from('<p>A</p>') }];
function setup(options: { lose?: number; fail?: boolean } = {}) {
  const f = fixture(); const receipts = new Map<string, HandoffReceipt>(); const order: string[] = [];
  const publish = vi.fn(async (_c, uploaded: readonly CandidateFile[]) =>
    ({ releaseId: 'release-A', manifestDigest: 'm', storedDigest: candidateDigest(uploaded) }));
  let lose = options.lose ?? 0;
  const host: RemoteHost = { job: vi.fn(async (_key, jobId: string) => ({ jobId, generation: 1, headSha: 'A', expectedReleaseId: 'release-B' })),
    accept: vi.fn(async (_key, handoff, uploaded) => {
      order.push('accept');
      if (options.fail) throw new Error('ECONNRESET');
      const receipt = await acceptHandoff({ scopeId: key.storageScopeId, builderKey: builder.publicKey, receiptKey: hostKeys.privateKey,
        now: () => 0, expect: () => true, publish, ledger: { find: async job => receipts.get(job),
          async transaction(job, work) { const done = await work(); receipts.set(job, done); return done; } } }, handoff, uploaded);
      if (lose-- > 0) throw new Error('response lost');
      return receipt;
    }) };
  const recorded: HandoffReceipt[] = [];
  const outcomes = { intend: vi.fn(async () => { order.push('intend'); }),
    record: vi.fn(async (_key, receipt: HandoffReceipt) => { recorded.push(receipt); return recorded[0]; }) };
  let exported = files;
  f.ports.worker.build = vi.fn(async () => ({ candidateDigest: candidateDigest(files) }));
  f.ports.publication = createHandoffPublication({ host, outcomes, candidates: { read: async () => exported },
    signingKey: () => builder.privateKey, hostKey: () => hostKeys.publicKey, now: () => 0 });
  return { f, host, publish, outcomes, recorded, order, repack(next: CandidateFile[]) { exported = next; } };
}

describe('builder-side SG4b publication port', () => {
  it('seals the clean build evidence, hands off once and records the verified receipt', async () => {
    const s = setup();
    await s.f.controller.buildOnly(key, 'job-1');
    expect(s.order).toEqual(['intend', 'accept']);
    const [, handoff] = vi.mocked(s.host.accept).mock.calls[0];
    expect(handoff.claims).toMatchObject({ jobId: 'job-1', kind: 'explicit', commitSha: 'A', treeSha: 'tree-A', generation: 1,
      tuple: { commitSha: 'A', treeSha: 'tree-A', descriptorDigest: 'descriptor-A', lockfileDigest: 'lock-sha',
        builderImageDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), nodeVersion: 'v24', npmVersion: '11' } });
    expect(Object.keys(handoff.claims.tuple.publicEnvHashes)).toContain('VITE_ARTIFACT_MODE');
    expect(s.recorded).toHaveLength(1); expect(s.publish).toHaveBeenCalledTimes(1);
    expect((await s.f.state())?.progress.lastSuccessfulReleaseId).toBe('release-A');
  });
  it('resends the same handoff after a lost response and never publishes twice', async () => {
    const s = setup({ lose: 1 });
    await s.f.controller.buildOnly(key, 'job-1');
    expect(s.host.accept).toHaveBeenCalledTimes(2); expect(s.publish).toHaveBeenCalledTimes(1);
    const [[, first], [, second]] = vi.mocked(s.host.accept).mock.calls;
    expect(second.claims.nonce).toBe(first.claims.nonce);
  });
  it('fails closed as indeterminate after bounded resends, keeping the durable intent', async () => {
    const s = setup({ fail: true });
    await expect(s.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'publication_indeterminate' });
    expect(s.outcomes.intend).toHaveBeenCalledTimes(1); expect(s.recorded).toHaveLength(0);
    expect((await s.f.state())?.progress.lastSuccessfulReleaseId).toBeNull();
  });
  it('refuses to hand off bytes that differ from the verified candidate (anti-repack)', async () => {
    const s = setup(); s.repack([{ path: 'index.html', bytes: Buffer.from('<p>evil</p>') }]);
    await expect(s.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'candidate_mismatch' });
    expect(s.host.accept).not.toHaveBeenCalled();
  });
  it('maps a host refusal and a forged receipt to closed failures without recording', async () => {
    const s = setup(); vi.mocked(s.host.accept).mockRejectedValueOnce(new HandoffError('handoff_expired'));
    await expect(s.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'publication_refused' });
    const forged = setup(); const other = generateKeyPairSync('ed25519');
    forged.f.ports.publication = createHandoffPublication({ host: forged.host, outcomes: forged.outcomes,
      candidates: { read: async () => files }, signingKey: () => builder.privateKey, hostKey: () => other.publicKey, now: () => 0 });
    await expect(forged.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'receipt_invalid' });
    expect(forged.recorded).toHaveLength(0);
  });
});
