import { describe, expect, it } from 'vitest';
import { candidateDigest } from '@sentropic/artifacts/live-host';
import { createCandidateStore } from '../../../src/services/artifacts/live/candidate-store';
import type { LiveAttempt, LiveRuntime } from '../../../src/services/artifacts/live/records';

const files = [{ path: 'index.html', mode: 0o644, bytes: Buffer.from('<p>A</p>') }];
const digest = candidateDigest(files);
const runtime = { podName: 'artifact-a', sessionId: 'run-1', leaseEpoch: 2 } as LiveRuntime;
const attempt = { id: 'job-1', candidateDigest: digest } as LiveAttempt;

describe('sealed candidate holder (W3 candidate sink to the SG4b upload)', () => {
  it('returns exactly the sealed bytes to the same run, attempt and digest', async () => {
    const store = createCandidateStore();
    await store.candidate({ runtime, attempt, candidateDigest: digest, files });
    expect(await store.read(runtime, attempt)).toEqual([{ path: 'index.html', bytes: files[0].bytes }]);
  });
  it('refuses a sink whose bytes do not match the sealed digest', async () => {
    await expect(createCandidateStore().candidate({ runtime, attempt, candidateDigest: 'f'.repeat(64), files }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'candidate_mismatch' });
  });
  it('refuses another run, attempt or digest, and keeps one candidate per pod', async () => {
    const store = createCandidateStore();
    await store.candidate({ runtime, attempt, candidateDigest: digest, files });
    for (const [r, a] of [[{ ...runtime, sessionId: 'run-2' }, attempt], [{ ...runtime, leaseEpoch: 3 }, attempt],
      [runtime, { ...attempt, id: 'job-2' }], [runtime, { ...attempt, candidateDigest: 'e'.repeat(64) }]] as const) {
      await expect(store.read(r, a)).rejects.toMatchObject({ reason: 'candidate_missing' });
    }
    const next = [{ path: 'index.html', mode: 0o644, bytes: Buffer.from('<p>B</p>') }];
    await store.candidate({ runtime: { ...runtime, sessionId: 'run-2' }, attempt, candidateDigest: candidateDigest(next), files: next });
    await expect(store.read(runtime, attempt)).rejects.toMatchObject({ reason: 'candidate_missing' });
  });
});
