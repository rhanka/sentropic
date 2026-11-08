import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptHandoff, candidateDigest, LiveHostError, type AttemptFence, type CandidateFile, type HandoffClaims,
  type HandoffReceipt, type HostRecheckView, type KeyResolver } from '@sentropic/artifacts/live-host';
import { createHandoffPublication, type RemoteHost } from '../../../src/services/artifacts/live/handoff-publication';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { fixture, gb1Descriptor, key } from './fixture';

const builder = generateKeyPairSync('ed25519'); const host1 = generateKeyPairSync('ed25519'); const host2 = generateKeyPairSync('ed25519');
const builderKeys = (kid: string) => (kid === 'builder-1' ? builder.publicKey : undefined);
const hostKeys: KeyResolver = kid => ({ 'host-1': host1.publicKey, 'host-2': host2.publicKey } as Record<string, KeyObject>)[kid];
const files: CandidateFile[] = [{ path: 'index.html', bytes: Buffer.from('<p>A</p>') }];
function setup(options: { lose?: number; fail?: boolean; receiptKid?: 'host-1' | 'host-2'; resolve?: KeyResolver } = {}) {
  const f = fixture(); const receipts = new Map<string, HandoffReceipt>(); const order: string[] = [];
  const fences = new Map<string, AttemptFence>();
  const publish = vi.fn(async (_c, uploaded: readonly CandidateFile[]) =>
    ({ releaseId: 'release-A', manifestDigest: 'm', storedDigest: candidateDigest(uploaded) }));
  // The host view: its pending job, with the attempt fence it recorded when the builder resolved the job.
  const view = (c: HandoffClaims): HostRecheckView => ({ scopeId: key.storageScopeId, killSwitch: false,
    imageAllowlist: [BUILDER_IMAGE.slice(BUILDER_IMAGE.indexOf('@') + 1)], currentReleaseId: 'release-B', headReachable: true,
    binding: { artifactId: key.artifactId, state: 'build_pending', generation: 1, executor: 'sandbox', autoPublish: false,
      pendingJobId: 'job-1', pendingCommitSha: 'A' },
    job: { jobId: 'job-1', state: 'building', bindingGeneration: 1, commitSha: 'A', expectedCurrentReleaseId: 'release-B',
      fence: fences.get(c.jobId) ?? null },
    policy: { ownerAuthorized: true, automaticAuthorized: false, automaticEligible: false } });
  let lose = options.lose ?? 0;
  const host: RemoteHost = {
    job: vi.fn(async (_key, jobId: string, fence: AttemptFence) => { fences.set(jobId, fence);
      return { jobId, generation: 1, headSha: 'A', expectedReleaseId: 'release-B' }; }),
    accept: vi.fn(async (_key, handoff, uploaded) => {
      order.push('accept');
      if (options.fail) throw new Error('ECONNRESET');
      const receiptKid = options.receiptKid ?? 'host-1';
      const receipt = await acceptHandoff({ scopeId: key.storageScopeId, builderKeys, now: () => 0, view, publish,
        receiptKey: { kid: receiptKid, key: (receiptKid === 'host-1' ? host1 : host2).privateKey },
        ledger: { find: async job => receipts.get(job),
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
    signingKey: () => ({ kid: 'builder-1', key: builder.privateKey }), hostKeys: options.resolve ?? hostKeys, now: () => 0 });
  return { f, host, publish, outcomes, recorded, order, fences, repack(next: CandidateFile[]) { exported = next; } };
}

describe('builder-side SG4b publication port', () => {
  it('seals the clean build evidence under the builder kid, hands off once and records the verified receipt', async () => {
    const s = setup();
    await s.f.controller.buildOnly(key, 'job-1');
    expect(s.order).toEqual(['intend', 'accept']);
    const [, handoff] = vi.mocked(s.host.accept).mock.calls[0];
    expect(handoff.claims).toMatchObject({ kid: 'builder-1', jobId: 'job-1', kind: 'explicit', commitSha: 'A', treeSha: 'tree-A',
      generation: 1, ...s.fences.get('job-1'), tuple: { commitSha: 'A', treeSha: 'tree-A', descriptorDigest: sha256(gb1Descriptor),
        lockfileDigest: 'lock-sha', builderImageDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), nodeVersion: 'v24', npmVersion: '11' } });
    expect(Object.keys(handoff.claims.tuple.publicEnvHashes)).toContain('VITE_ARTIFACT_MODE');
    expect(s.recorded).toEqual([expect.objectContaining({ kid: 'host-1', releaseId: 'release-A' })]);
    expect(s.publish).toHaveBeenCalledTimes(1);
    expect((await s.f.state())?.progress.lastSuccessfulReleaseId).toBe('release-A');
  });
  it('verifies a receipt signed by a rotated host key whose kid is known', async () => {
    const s = setup({ receiptKid: 'host-2' }); await s.f.controller.buildOnly(key, 'job-1');
    expect(s.recorded).toEqual([expect.objectContaining({ kid: 'host-2' })]);
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
  it('is refused by the host when a newer attempt fence superseded this run', async () => {
    const s = setup(); const job = vi.mocked(s.host.job).getMockImplementation()!;
    vi.mocked(s.host.job).mockImplementationOnce(async (k, jobId, fence) => {
      const resolved = await job(k, jobId, fence); s.fences.set(jobId, { ...fence, attempt: fence.attempt + 1 }); return resolved; });
    await expect(s.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'publication_refused' });
    expect(s.publish).not.toHaveBeenCalled();
  });
  it('maps a host refusal, a forged receipt and an unknown receipt kid to closed failures without recording', async () => {
    const s = setup(); vi.mocked(s.host.accept).mockRejectedValueOnce(new LiveHostError('handoff_expired'));
    await expect(s.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'publication_refused' });
    const other = generateKeyPairSync('ed25519');
    for (const resolve of [() => other.publicKey, () => undefined]) {
      const forged = setup({ resolve });
      await expect(forged.f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'receipt_invalid' });
      expect(forged.recorded).toHaveLength(0);
    }
  });
});
