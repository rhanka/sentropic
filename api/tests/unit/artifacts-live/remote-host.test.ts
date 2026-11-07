import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  candidateDigest, HOST_BUILD_PATHS, LiveHostError, parseHandoffRequest, sealHandoff, verifyJobRequest, type HandoffReceipt,
} from '@sentropic/artifacts/live-host';
import { BUILDER_REMOTE_HOST_ENV, builderRemoteHost, createHttpRemoteHost } from '../../../src/services/artifacts/live/remote-host';

const builder = { kid: 'builder-1', key: generateKeyPairSync('ed25519').privateKey };
const builderKeys = (kid: string) => (kid === 'builder-1' ? createPublicKey(builder.key) : undefined);
const key = { storageScopeId: 'scope-a', artifactId: 'artifact-a' };
const fence = { runId: 'run-1', attempt: 2 };
const hostJob = { jobId: 'job-1', generation: 1, headSha: 'c'.repeat(40), expectedReleaseId: null };
const files = [{ path: 'index.html', bytes: new Uint8Array(Buffer.from('<p>B</p>')) }];
const tuple = { commitSha: 'c'.repeat(40), treeSha: 't'.repeat(40), lockfileDigest: 'l', descriptorDigest: 'd', builderImageDigest: 'i',
  nodeVersion: 'v24', npmVersion: '11', publicEnvHashes: {} };
const handoff = sealHandoff({ scopeId: 'scope-a', artifactId: 'artifact-a', jobId: 'job-1', kind: 'explicit', runId: 'run-1', attempt: 2,
  generation: 1, commitSha: tuple.commitSha, treeSha: tuple.treeSha, tuple, candidateDigest: candidateDigest(files), expectedReleaseId: null },
builder, 1_000);
const receipt = { v: 1, kid: 'host-1', releaseId: 'release-A' } as unknown as HandoffReceipt;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function setup(answer: (path: string, body: unknown) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    answer(new URL(String(url)).pathname, JSON.parse(String(init?.body))));
  const host = createHttpRemoteHost({ baseUrl: 'https://immo.test/api/v1/artifacts/', signingKey: () => builder, now: () => 1_000,
    fetch: fetch as unknown as typeof globalThis.fetch });
  return { host, fetch };
}

describe('HTTP remote host (live-host host build paths)', () => {
  it('resolves the pending job with a request the host authenticates for its scope', async () => {
    const s = setup((path, body) => {
      expect(path).toBe(`/api/v1/artifacts${HOST_BUILD_PATHS.job}`);
      expect(verifyJobRequest(body, { scopeId: 'scope-a', builderKeys, now: 1_000 })).toMatchObject({ jobId: 'job-1', fence });
      return json(200, { v: 1, job: hostJob });
    });
    expect(await s.host.job(key, 'job-1', fence)).toEqual(hostJob);
    expect(s.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });
  it('sends the sealed handoff with the exact candidate bytes and returns the host receipt', async () => {
    const s = setup((path, body) => {
      expect(path).toBe(`/api/v1/artifacts${HOST_BUILD_PATHS.handoff}`);
      const parsed = parseHandoffRequest(body);
      expect(parsed.handoff).toEqual(handoff); expect(candidateDigest(parsed.files)).toBe(candidateDigest(files));
      return json(200, { v: 1, receipt });
    });
    expect(await s.host.accept(key, handoff, files)).toEqual(receipt);
  });
  it('rejects a closed host refusal with LiveHostError, so the publication never resends it', async () => {
    const s = setup(() => json(409, { v: 1, error: 'handoff_mismatch', reason: 'job_not_pending' }));
    const error = await s.host.job(key, 'job-1', fence).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LiveHostError); expect(error).toMatchObject({ code: 'handoff_mismatch', reason: 'job_not_pending' });
  });
  it('treats any other answer as a transport failure with an unknown outcome', async () => {
    for (const answer of [() => new Response('oops', { status: 502 }), () => json(500, { v: 1, error: 'free text' }),
      () => json(200, { v: 1, job: { ...hostJob, generation: '1' } }), () => json(200, { job: hostJob }),
      () => { throw new TypeError('network'); }]) {
      const error = await setup(answer).host.job(key, 'job-1', fence).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(LiveHostError);
    }
    const missing = await setup(() => json(200, { v: 1 })).host.accept(key, handoff, files).catch((caught: unknown) => caught);
    expect(missing).not.toBeInstanceOf(LiveHostError);
  });
  it('refuses a base URL that is not https or carries credentials, a query or a fragment', () => {
    for (const baseUrl of ['http://immo.test/', 'https://user:pw@immo.test/', 'https://immo.test/?a=1', 'https://immo.test/#x', 'not a url']) {
      expect(() => createHttpRemoteHost({ baseUrl, signingKey: () => builder, now: () => 0 }))
        .toThrow(expect.objectContaining({ code: 'builder_unavailable', reason: 'host_unconfigured' }));
    }
  });
  it('takes the content host base from the fixed env name and reaches the preprod live-host routes', async () => {
    expect(BUILDER_REMOTE_HOST_ENV).toBe('ARTIFACT_BUILDER_REMOTE_HOST_URL');
    const fetch = vi.fn(async () => json(200, { v: 1, job: hostJob }));
    const host = builderRemoteHost({ [BUILDER_REMOTE_HOST_ENV]: 'https://preprod.immo.sent-tech.ca/api/v1/artifacts' },
      { signingKey: () => builder, now: () => 1_000, fetch: fetch as unknown as typeof globalThis.fetch });
    await host.job(key, 'job-1', fence);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://preprod.immo.sent-tech.ca/api/v1/artifacts/live-host/v1/job');
  });
  it('refuses to compose without a configured content host base', () => {
    for (const env of [{}, { [BUILDER_REMOTE_HOST_ENV]: '' }, { [BUILDER_REMOTE_HOST_ENV]: 'http://preprod.immo.sent-tech.ca/api' }]) {
      expect(() => builderRemoteHost(env, { signingKey: () => builder, now: () => 0 }))
        .toThrow(expect.objectContaining({ code: 'builder_unavailable', reason: 'host_unconfigured' }));
    }
  });
});
