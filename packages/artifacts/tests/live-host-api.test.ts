import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encodeHandoffRequest, JOB_REQUEST_LIFETIME_MS, parseHandoffRequest, refusalFrom, refusalOf, sealJobRequest, verifyJobRequest,
} from '../src/live-host/api.js';
import { candidateDigest } from '../src/live-host/candidate.js';
import { LiveHostError } from '../src/live-host/errors.js';
import { sealHandoff } from '../src/live-host/handoff.js';

const builder = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey };
const builderKeys = (kid: string) => (kid === 'builder-1' ? createPublicKey(builder.key) : undefined);
const job = { scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1', fence: { runId: 'run-1', attempt: 2 } };
const host = (now = 1_000) => ({ scopeId: 'scope-a', builderKeys, now });
const files = [{ path: 'index.html', bytes: Buffer.from('<p>B</p>') }, { path: 'assets/a.bin', bytes: Buffer.from([0, 255, 7]) }];
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l', descriptorDigest: 'd', builderImageDigest: 'i',
  nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: {} };
const handoff = sealHandoff({ ...job, kind: 'explicit', runId: 'run-1', attempt: 2, generation: 1, commitSha: tuple.commitSha,
  treeSha: tuple.treeSha, tuple, candidateDigest: candidateDigest(files), expectedReleaseId: null }, builder, 1_000);

describe('live-host host build API (A-LIVE 8.4)', () => {
  it('authenticates a fresh builder job request for this host scope, after a JSON round trip', () => {
    const request = JSON.parse(JSON.stringify(sealJobRequest(job, builder, 1_000)));
    expect(verifyJobRequest(request, host(1_000 + JOB_REQUEST_LIFETIME_MS - 1))).toMatchObject({ ...job, kid: 'builder-1' });
  });
  it('refuses a forged, expired, early, foreign-scope or malformed job request', () => {
    const request = sealJobRequest(job, builder, 1_000);
    const other = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey };
    for (const [bad, now] of [[sealJobRequest(job, other, 1_000), 1_000], [request, 1_000 + JOB_REQUEST_LIFETIME_MS], [request, -5_000],
      [{ ...request, claims: { ...request.claims, fence: { runId: 'run-1', attempt: 9 } } }, 1_000], [null, 1_000], [{}, 1_000],
      [sealJobRequest({ ...job, fence: { runId: 'run-1', attempt: 0 } }, builder, 1_000), 1_000],
      [sealJobRequest({ ...job, jobId: '' }, builder, 1_000), 1_000]] as const) {
      expect(() => verifyJobRequest(bad, host(now))).toThrow('request_invalid');
    }
    let error: unknown;
    try { verifyJobRequest(sealJobRequest({ ...job, scopeId: 'scope-b' }, builder, 1_000), host()); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'handoff_mismatch', reason: 'scope_mismatch' });
  });
  it('round-trips the handoff request with the exact candidate bytes', () => {
    const parsed = parseHandoffRequest(JSON.parse(JSON.stringify(encodeHandoffRequest(handoff, files))));
    expect(parsed.handoff).toEqual(handoff);
    expect(candidateDigest(parsed.files)).toBe(handoff.claims.candidateDigest);
  });
  it('refuses a malformed handoff request, a non-canonical base64 and an unsafe path', () => {
    const body = encodeHandoffRequest(handoff, files);
    for (const bad of [null, { ...body, v: 2 }, { ...body, files: [] }, { ...body, handoff: null },
      { ...body, files: Array.from({ length: 256 }, (_, i) => ({ path: `f${i}`, base64: '' })) },
      { ...body, files: [{ path: 'a', base64: 'AP8H', mode: 0o755 }] }, { ...body, files: [{ path: 'a', base64: 'AB==' }] },
      { ...body, files: [{ path: 'a', base64: 'AP8H\n' }] }, { ...body, files: [{ path: '../a', base64: 'AA==' }] },
      { ...body, files: [{ path: 'a', base64: 'A'.repeat(22_369_625) }] }]) {
      expect(() => parseHandoffRequest(bad)).toThrow('request_invalid');
    }
  });
  it('maps host refusals to closed bodies and back; anything else stays a transport failure', () => {
    const refusal = refusalOf(new LiveHostError('handoff_mismatch', 'release_conflict'));
    expect(refusal).toEqual({ v: 1, error: 'handoff_mismatch', reason: 'release_conflict' });
    expect(refusalFrom(JSON.parse(JSON.stringify(refusal)))).toMatchObject({ code: 'handoff_mismatch', reason: 'release_conflict' });
    expect(refusalOf(new LiveHostError('handoff_replayed'))).toEqual({ v: 1, error: 'handoff_replayed' });
    expect(refusalOf(new Error('db down'))).toBeUndefined();
    for (const body of [null, { v: 1, error: 'other' }, { v: 1, error: 'handoff_mismatch', reason: 'free text' }, { error: 'handoff_replayed' }]) {
      expect(refusalFrom(body)).toBeUndefined();
    }
  });
});
