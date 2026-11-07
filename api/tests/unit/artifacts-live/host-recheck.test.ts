import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptHandoff, candidateDigest, sealHandoff, type CandidateFile, type HandoffClaims } from '../../../src/services/artifacts/live/handoff';
import { publicationRecheck, resolvePendingJob, type HostRecheckView } from '../../../src/services/artifacts/live/host-recheck';

const files: CandidateFile[] = [{ path: 'index.html', bytes: Buffer.from('<p>A</p>') }];
const image = `sha256:${'i'.repeat(64)}`;
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l'.repeat(64), descriptorDigest: 'd'.repeat(64),
  builderImageDigest: image, nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: {} };
const input = { scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1', kind: 'explicit' as const, runId: 'run-1', attempt: 2,
  generation: 3, commitSha: tuple.commitSha, treeSha: tuple.treeSha, tuple, candidateDigest: candidateDigest(files), expectedReleaseId: 'release-A' };
const builder = generateKeyPairSync('ed25519');
const claims = (): HandoffClaims => structuredClone(sealHandoff(input, builder.privateKey, 0).claims);
const view = (): HostRecheckView => ({
  scopeId: 'scope-a', killSwitch: false, imageAllowlist: [image], currentReleaseId: 'release-A', headReachable: true,
  binding: { artifactId: 'artifact-a', state: 'build_pending', generation: 3, executor: 'sandbox', autoPublish: false,
    pendingJobId: 'job-1', pendingCommitSha: tuple.commitSha },
  job: { jobId: 'job-1', state: 'building', bindingGeneration: 3, commitSha: tuple.commitSha, expectedCurrentReleaseId: 'release-A',
    fence: { runId: 'run-1', attempt: 2 } },
  policy: { ownerAuthorized: true, automaticAuthorized: false, automaticEligible: false },
});
const refusals: [string, (v: HostRecheckView, c: HandoffClaims) => void][] = [
  ['scope_mismatch', (_v, c) => { c.scopeId = 'scope-b'; }],
  ['scope_mismatch', (v) => { v.binding.artifactId = 'artifact-b'; }],
  ['publication_paused', (v) => { v.killSwitch = true; }],
  ['publication_paused', (v) => { v.binding.state = 'paused'; }],
  ['generation_mismatch', (v) => { v.binding.generation = 4; }],
  ['job_not_pending', (v) => { v.binding.pendingJobId = 'job-2'; }],
  ['job_not_pending', (v) => { v.job = undefined; }],
  ['job_not_pending', (v) => { v.job!.state = 'cancelled'; }],
  ['job_not_pending', (v) => { v.job!.bindingGeneration = 2; }],
  ['job_not_pending', (v) => { v.binding.pendingCommitSha = 'e'.repeat(40); }],
  ['job_not_pending', (v) => { v.binding.executor = 'caller'; }],
  ['attempt_fenced', (v) => { v.job!.fence = { runId: 'run-1', attempt: 3 }; }],
  ['attempt_fenced', (v) => { v.job!.fence = { runId: 'run-2', attempt: 2 }; }],
  ['attempt_fenced', (v) => { v.job!.fence = null; }],
  ['policy_refused', (v) => { v.policy.ownerAuthorized = false; }],
  ['policy_refused', (v, c) => { c.kind = 'idle'; v.binding.autoPublish = true; v.policy.automaticAuthorized = true; }],
  ['head_unreachable', (v) => { v.headReachable = false; }],
  ['release_conflict', (v) => { v.currentReleaseId = 'release-B'; }],
  ['release_conflict', (v) => { v.job!.expectedCurrentReleaseId = null; }],
  ['image_not_allowed', (v) => { v.imageAllowlist = [`sha256:${'j'.repeat(64)}`]; }],
];

describe('host publication recheck: the expect() contract (A-LIVE §8.3)', () => {
  it('admits the pending job of the current generation, attempt, head, release and image', () => {
    expect(publicationRecheck(view(), claims())).toBeNull();
    const idle = view(); idle.binding.autoPublish = true; idle.policy = { ownerAuthorized: false, automaticAuthorized: true, automaticEligible: true };
    expect(publicationRecheck(idle, { ...claims(), kind: 'idle' })).toBeNull();
  });
  it.each(refusals)('refuses with %s', (code, change) => {
    const v = view(); const c = claims(); change(v, c);
    expect(publicationRecheck(v, c)).toBe(code);
  });
  it('drives acceptHandoff: a refused recheck publishes nothing', async () => {
    const host = generateKeyPairSync('ed25519'); const publish = vi.fn();
    const v = view(); v.killSwitch = true;
    await expect(acceptHandoff({ scopeId: 'scope-a', builderKey: builder.publicKey, receiptKey: host.privateKey, now: () => 1,
      ledger: { find: async () => undefined, transaction: async (_job, work) => work() },
      expect: c => publicationRecheck(v, c) === null, publish }, sealHandoff(input, builder.privateKey, 0), files))
      .rejects.toMatchObject({ code: 'handoff_mismatch' });
    expect(publish).not.toHaveBeenCalled();
  });
  it('resolves a job for the builder only when it is the binding pending job at its generation, recording the attempt fence', () => {
    const v = view(); v.job!.fence = { runId: 'run-0', attempt: 1 };
    expect(resolvePendingJob(v, 'job-1', { runId: 'run-1', attempt: 2 })).toEqual({ resolved: { jobId: 'job-1', generation: 3,
      headSha: tuple.commitSha, expectedReleaseId: 'release-A' }, fence: { runId: 'run-1', attempt: 2 } });
    expect(resolvePendingJob(v, 'job-2', { runId: 'run-1', attempt: 2 })).toBeNull();
    expect(resolvePendingJob(v, 'job-1', { runId: 'run-9', attempt: 1 })).toBeNull();
    const stale = view(); stale.job!.bindingGeneration = 2;
    expect(resolvePendingJob(stale, 'job-1', { runId: 'run-1', attempt: 3 })).toBeNull();
  });
});
