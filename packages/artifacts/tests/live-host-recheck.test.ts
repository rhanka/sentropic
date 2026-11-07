import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { candidateDigest } from '../src/live-host/candidate.js';
import { sealHandoff, type HandoffClaims } from '../src/live-host/handoff.js';
import { publicationRecheck, resolvePendingJob, type HostRecheckView } from '../src/live-host/recheck.js';

const files = [{ path: 'index.html', bytes: Buffer.from('<p>A</p>') }];
const image = `sha256:${'i'.repeat(64)}`;
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l'.repeat(64), descriptorDigest: 'd'.repeat(64),
  builderImageDigest: image, nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: {} };
const input = { scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1', kind: 'explicit' as const, runId: 'run-1', attempt: 2,
  generation: 3, commitSha: tuple.commitSha, treeSha: tuple.treeSha, tuple, candidateDigest: candidateDigest(files), expectedReleaseId: 'release-A' };
const signer = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey };
const claims = (): HandoffClaims => structuredClone(sealHandoff(input, signer, 0).claims);
const recheckView = (): HostRecheckView => ({
  scopeId: 'scope-a', killSwitch: false, imageAllowlist: [image], currentReleaseId: 'release-A', headReachable: true,
  binding: { artifactId: 'artifact-a', state: 'build_pending', generation: 3, executor: 'sandbox', autoPublish: false,
    pendingJobId: 'job-1', pendingCommitSha: tuple.commitSha },
  job: { jobId: 'job-1', state: 'building', bindingGeneration: 3, commitSha: tuple.commitSha, expectedCurrentReleaseId: 'release-A',
    fence: { runId: 'run-1', attempt: 2 } },
  policy: { ownerAuthorized: true, automaticAuthorized: false, automaticEligible: false },
});
const idle = (v: HostRecheckView, c: HandoffClaims) => { c.kind = 'idle'; v.binding.autoPublish = true; v.policy.automaticAuthorized = true; };
const refusals: [string, (v: HostRecheckView, c: HandoffClaims) => void][] = [
  ['scope_mismatch', (_v, c) => { c.scopeId = 'scope-b'; }],
  ['scope_mismatch', v => { v.binding.artifactId = 'artifact-b'; }],
  ['publication_paused', v => { v.killSwitch = true; }],
  ['publication_paused', v => { v.binding.state = 'paused'; }],
  ['generation_mismatch', v => { v.binding.generation = 4; }],
  ['job_not_pending', v => { v.binding.pendingJobId = 'job-2'; }],
  ['job_not_pending', v => { v.job = undefined; }],
  ['job_not_pending', v => { v.job!.state = 'cancelled'; }],
  ['job_not_pending', v => { v.job!.bindingGeneration = 2; }],
  ['job_not_pending', v => { v.binding.pendingCommitSha = 'e'.repeat(40); }],
  ['job_not_pending', v => { v.binding.executor = 'caller'; }],
  ['attempt_fenced', v => { v.job!.fence = { runId: 'run-1', attempt: 3 }; }],
  ['attempt_fenced', v => { v.job!.fence = { runId: 'run-2', attempt: 2 }; }],
  ['attempt_fenced', v => { v.job!.fence = null; }],
  ['policy_refused', v => { v.policy.ownerAuthorized = false; }],
  ['policy_refused', idle],
  ['policy_refused', (v, c) => { idle(v, c); v.policy.automaticEligible = true; v.binding.autoPublish = false; }],
  ['head_unreachable', v => { v.headReachable = false; }],
  ['release_conflict', v => { v.currentReleaseId = 'release-B'; }],
  ['release_conflict', v => { v.job!.expectedCurrentReleaseId = null; }],
  ['image_not_allowed', v => { v.imageAllowlist = [`sha256:${'j'.repeat(64)}`]; }],
];

describe('live-host publication recheck: the expect() contract (A-LIVE 8.3)', () => {
  it('admits the pending job of the current generation, attempt, head, release and image', () => {
    expect(publicationRecheck(recheckView(), claims())).toBeNull();
    const v = recheckView(); const c = claims(); idle(v, c); v.policy.automaticEligible = true; v.policy.ownerAuthorized = false;
    expect(publicationRecheck(v, c)).toBeNull();
  });
  it.each(refusals)('refuses with %s', (code, change) => {
    const v = recheckView(); const c = claims(); change(v, c);
    expect(publicationRecheck(v, c)).toBe(code);
  });
  it('resolves only the binding pending job at its generation and records a monotonic attempt fence', () => {
    const v = recheckView(); v.job!.fence = { runId: 'run-0', attempt: 1 };
    expect(resolvePendingJob(v, 'job-1', { runId: 'run-1', attempt: 2 })).toEqual({ job: { jobId: 'job-1', generation: 3,
      headSha: tuple.commitSha, expectedReleaseId: 'release-A' }, fence: { runId: 'run-1', attempt: 2 } });
    expect(resolvePendingJob(v, 'job-1', { runId: 'run-0', attempt: 1 })).not.toBeNull();
    for (const fence of [{ runId: 'run-9', attempt: 1 }, { runId: 'run-9', attempt: 0 }, { runId: '', attempt: 3 }, { runId: 'r', attempt: 2.5 }]) {
      expect(resolvePendingJob(v, 'job-1', fence)).toBeNull();
    }
    expect(resolvePendingJob(v, 'job-2', { runId: 'run-1', attempt: 2 })).toBeNull();
    const stale = recheckView(); stale.job!.bindingGeneration = 2;
    expect(resolvePendingJob(stale, 'job-1', { runId: 'run-1', attempt: 3 })).toBeNull();
  });
});
