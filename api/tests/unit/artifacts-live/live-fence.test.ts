import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FENCE_HEADER, MAX_CONTROL_SECONDS, verifyLiveFence } from '@sentropic/artifacts/live-host';
import {
  controllerFenceKey, createLiveFenceRoutes, LIVE_CONTROLLER_KEY_ENV, LIVE_EDGE_URL_ENV, LIVE_FENCE_PATH, liveEdgeUrl,
} from '../../../src/services/artifacts/live/live-fence';
import type { LiveRuntime } from '../../../src/services/artifacts/live/records';

const EDGE = 'http://artifact-content.sentropic-test.svc.cluster.local:8791';
const material = randomBytes(32);
const fenceKey = controllerFenceKey({ [LIVE_CONTROLLER_KEY_ENV]: `sentropic-test-live-1=${material.toString('base64url')}` });
const key = { storageScopeId: 'immo', artifactId: 'artifact-a' };
const runtime = (generation: number, routeEpoch: number) => ({ generation, routeEpoch }) as LiveRuntime;
const NOW = 1_800_000_000_000;

function edge(statuses: number[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: statuses.shift() ?? 204 });
  }) as unknown as typeof globalThis.fetch;
  const token = (index: number) => (calls[index].init.headers as Record<string, string>)[FENCE_HEADER];
  return { fetch, calls, token };
}
const routes = (fetch: typeof globalThis.fetch, backoffMs = [0, 0]) =>
  createLiveFenceRoutes({ baseUrl: EDGE, key: fenceKey, now: () => NOW, fetch, backoffMs });

describe('f1 controller fence signer (A-LIVE §8.2)', () => {
  it('should push a fence the edge verifies with the controller key ring, on every route epoch or generation change', async () => {
    const e = edge([]);
    const fences = routes(e.fetch);
    await fences.revoke(key, runtime(2, 5));
    await fences.ready(key, runtime(3, 1));
    expect(e.calls.map(call => [call.url, call.init.method, call.init.redirect]))
      .toEqual([[`${EDGE}${LIVE_FENCE_PATH}`, 'POST', 'error'], [`${EDGE}${LIVE_FENCE_PATH}`, 'POST', 'error']]);
    const verify = (token: string) => verifyLiveFence(token, { key: kid => (kid === 'sentropic-test-live-1' ? material : undefined), now: () => NOW });
    const first = verify(e.token(0)); const second = verify(e.token(1));
    expect(first).toMatchObject({ v: 1, kid: 'sentropic-test-live-1', artifactId: 'artifact-a', generation: 2, routeEpoch: 5 });
    expect(second).toMatchObject({ artifactId: 'artifact-a', generation: 3, routeEpoch: 1 });
    expect(first!.exp - first!.iat).toBeLessThanOrEqual(MAX_CONTROL_SECONDS);
  });

  it('should be refused by an edge holding another key', async () => {
    const e = edge([]);
    await routes(e.fetch).revoke(key, runtime(1, 1));
    expect(verifyLiveFence(e.token(0), { key: () => randomBytes(32), now: () => NOW })).toBeUndefined();
  });

  it('should resend a freshly signed fence after a 503 or a network error, then succeed', async () => {
    let now = NOW;
    const e = edge([503]);
    let failed = false;
    const flaky = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!failed) { failed = true; throw new Error('ECONNRESET'); }
      return e.fetch(url, init);
    }) as typeof globalThis.fetch;
    const fences = createLiveFenceRoutes({ baseUrl: EDGE, key: fenceKey, now: () => (now += 1_000), fetch: flaky, backoffMs: [0, 0] });
    await expect(fences.revoke(key, runtime(1, 2))).resolves.toBeUndefined();
    expect(e.calls).toHaveLength(2);
    expect(e.token(0)).not.toBe(e.token(1));
  });

  it('should refuse as builder_unavailable when the edge never confirms', async () => {
    const e = edge([503, 500, 404]);
    await expect(routes(e.fetch).ready(key, runtime(1, 1))).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'fence_unconfirmed' });
    expect(e.calls).toHaveLength(3);
  });

  it('should refuse to compose against a public content Host or a malformed internal URL', () => {
    for (const baseUrl of ['https://artifacts.sent-tech.ca', 'http://artifacts.sent-tech.ca', `${EDGE}/x`, `${EDGE}?a=1`,
      'http://user:pw@artifact-content.sentropic-test.svc.cluster.local:8791', '', 'not a url']) {
      expect(() => liveEdgeUrl({ [LIVE_EDGE_URL_ENV]: baseUrl })).toThrow(expect.objectContaining({ reason: 'fence_unconfigured' }));
      expect(() => createLiveFenceRoutes({ baseUrl, key: fenceKey, now: () => NOW, fetch: edge([]).fetch }))
        .toThrow(expect.objectContaining({ code: 'builder_unavailable' }));
    }
    expect(liveEdgeUrl({ [LIVE_EDGE_URL_ENV]: `${EDGE}/` })).toBe(EDGE);
  });

  it('should refuse an absent, short or malformed controller key without echoing it', () => {
    const short = `sentropic-test-live-1=${randomBytes(16).toString('base64url')}`;
    for (const value of [undefined, '', short, `=${material.toString('base64url')}`, `kid=${material.toString('base64')}+/`, 'kid only']) {
      let message = '';
      try { controllerFenceKey({ [LIVE_CONTROLLER_KEY_ENV]: value }); } catch (error) { message = String(error); }
      expect(message).toContain('builder_unavailable');
      if (value) expect(message).not.toContain(value);
    }
  });
});
