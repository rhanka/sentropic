import { describe, expect, it, vi } from 'vitest';
import {
  ASSERTION_HEADER, createHostAssertionLive, createLiveFences, signLiveAssertion, verifyLiveAssertion,
  type LiveAssertionClaims,
} from '../src/live-assertion';
import { createContentHost } from '../src/host';
import { createLiveProxy } from '../src/live';
import { podName } from '../../../api/src/services/artifacts/live/pods';

const artifactId = '11111111-1111-4111-8111-111111111111';
const pagesDomain = 'pages.immo.example';
const host = `${artifactId}.${pagesDomain}`;
const origin = `https://${host}`;
const key = Buffer.alloc(32, 7);
const t0 = 1_000_000;
function claims(over: Partial<LiveAssertionClaims> = {}): LiveAssertionClaims {
  const base = { v: 1 as const, kid: 'immo-1', host, artifactId, storageScopeId: 'scope', sessionId: 'session',
    generation: 1, routeEpoch: 1, podUid: 'uid', podName: '', sourceRevision: 3, principalId: 'owner',
    iat: t0 / 1000, exp: t0 / 1000 + 600, ...over };
  base.podName = over.podName ?? podName(base);
  return base;
}
function fixture(time = { now: t0 }) {
  const fences = createLiveFences();
  const admittedPath = vi.fn(async () => true);
  const live = createHostAssertionLive({ hosts: [{ pagesDomain, keyIds: ['immo-1'] }],
    key: kid => kid === 'immo-1' ? key : undefined, fences, admittedPath, now: () => time.now,
    fetch: vi.fn(async () => new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } })) });
  const proxy = createLiveProxy(live);
  const req = (token: string | undefined, path = '/', init: RequestInit = {}) => new Request(origin + path,
    { ...init, headers: { ...(token ? { [ASSERTION_HEADER]: token } : {}), ...(init.headers as object) } });
  return { fences, admittedPath, live, proxy, req, time };
}
const sign = (c = claims(), k = key) => signLiveAssertion(c, k);

describe('signed host assertion', () => {
  it('should round-trip and reject tampering, short keys, wrong key and malformed tokens', () => {
    const keys = (kid: string) => kid === 'immo-1' ? key : undefined;
    expect(verifyLiveAssertion(sign(), { key: keys, now: () => t0 })).toMatchObject({ artifactId, sessionId: 'session' });
    const [v, body, mac] = sign().split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims(), principalId: 'attacker' })).toString('base64url');
    for (const bad of [`${v}.${forged}.${mac}`, `${v}.${body}.${mac.slice(0, -2)}AA`, sign(claims(), Buffer.alloc(32, 9)),
      'garbage', '', `v2.${body}.${mac}`, `${v}.${body}`]) {
      expect(verifyLiveAssertion(bad, { key: keys, now: () => t0 })).toBeUndefined();
    }
    expect(() => signLiveAssertion(claims(), Buffer.alloc(8))).toThrow();
    expect(verifyLiveAssertion(sign(), { key: () => Buffer.alloc(8, 1), now: () => t0 })).toBeUndefined();
  });
  it('should refuse expired, not-yet-valid and over-long assertions', () => {
    const keys = () => key;
    expect(verifyLiveAssertion(sign(), { key: keys, now: () => t0 + 601_000 })).toBeUndefined();
    expect(verifyLiveAssertion(sign(claims({ iat: t0 / 1000 + 120, exp: t0 / 1000 + 700 })), { key: keys, now: () => t0 })).toBeUndefined();
    expect(verifyLiveAssertion(sign(claims({ exp: t0 / 1000 + 4 * 3600 })), { key: keys, now: () => t0 })).toBeUndefined();
    expect(verifyLiveAssertion(sign(claims({ exp: t0 / 1000 - 1 })), { key: keys, now: () => t0 })).toBeUndefined();
  });
});

describe('host assertion live edge', () => {
  it('should serve live content on the configured pages domain and strip the assertion and credentials', async () => {
    const f = fixture();
    const response = await f.proxy.fetch(f.req(sign(), '/', { headers: { cookie: 'c', authorization: 'a', accept: 'text/html' } }), artifactId);
    expect(response?.status).toBe(200);
    const [, options] = vi.mocked(f.live.fetch!).mock.calls[0];
    expect(options?.headers).toEqual({ accept: 'text/html', 'accept-encoding': 'identity' });
    expect(response!.headers.get('content-security-policy')).toContain(`wss://${host}/_live/session/hmr`);
  });
  it('should treat a request without an assertion, or a copied URL, as no authority', async () => {
    const f = fixture();
    expect(await f.live.authorize(f.req(undefined), artifactId)).toBeUndefined();
    expect(await f.live.authorize(f.req('', '/'), artifactId)).toBeUndefined();
    expect(f.live.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['wrong host', { host: `22222222-2222-4222-8222-222222222222.${pagesDomain}` }],
    ['wrong artifact', { artifactId: '22222222-2222-4222-8222-222222222222' }],
    ['unlisted key id', { kid: 'other' }],
    ['forged pod', { podName: 'arbitrary' }],
  ])('should refuse %s', async (_name, over) => {
    const f = fixture(); const c = claims(over as Partial<LiveAssertionClaims>);
    if (_name === 'forged pod') c.podName = 'arbitrary';
    expect(await f.live.authorize(f.req(sign(c)), artifactId)).toBeUndefined();
  });
  it('should refuse a foreign domain even with a valid signature', async () => {
    const f = fixture();
    const foreign = new Request(`https://${artifactId}.evil.example/`, { headers: { [ASSERTION_HEADER]: sign() } });
    expect(await f.live.authorize(foreign, artifactId)).toBeUndefined();
  });
  it('should refuse duplicate assertion headers', async () => {
    const f = fixture(); const headers = new Headers(); headers.append(ASSERTION_HEADER, sign()); headers.append(ASSERTION_HEADER, sign());
    expect(await f.live.authorize(new Request(origin, { headers }), artifactId)).toBeUndefined();
  });
  it('should expose the origin only for configured pages domains', () => {
    const f = fixture();
    expect(f.live.origin(host)).toEqual({ kind: 'id', id: artifactId });
    expect(f.live.origin(`${artifactId}.content.example`)).toBeUndefined();
    expect(f.live.origin(`a.${host}`)).toBeUndefined();
  });
  it('should revoke sockets and refuse routes on session revoke, generation fence and expiry', async () => {
    const f = fixture(); const route = (await f.live.authorize(f.req(sign()), artifactId))!;
    expect(route).toBeDefined(); const close = vi.fn(); f.live.watch(route, close);
    expect(await f.live.current(route)).toBe(true);
    f.fences.revoke({ artifactId, sessionId: 'other' }); expect(close).not.toHaveBeenCalled();
    f.fences.revoke({ artifactId, sessionId: 'session' });
    expect(close).toHaveBeenCalledTimes(1); expect(await f.live.current(route)).toBe(false);
    expect(await f.live.authorize(f.req(sign()), artifactId)).toBeUndefined();
  });
  it('should revoke on a newer generation or route epoch and stop watching after unwatch', async () => {
    const f = fixture(); const route = (await f.live.authorize(f.req(sign()), artifactId))!;
    const close = vi.fn(); const unwatch = f.live.watch(route, close);
    f.fences.fence({ artifactId, generation: 1, routeEpoch: 2 });
    expect(close).toHaveBeenCalledTimes(1); expect(await f.live.current(route)).toBe(false);
    unwatch(); const other = vi.fn(); f.live.watch({ ...route, routeEpoch: 2 }, other); unwatch();
    f.fences.fence({ artifactId, generation: 2, routeEpoch: 1 }); expect(other).toHaveBeenCalledTimes(1);
    const fresh = await f.live.authorize(f.req(sign(claims({ generation: 2, routeEpoch: 3 }))), artifactId);
    expect(fresh).toBeDefined();
  });
  it('should delegate source admission to the host manifest port', async () => {
    const f = fixture(); f.admittedPath.mockResolvedValueOnce(false);
    expect(await f.proxy.fetch(f.req(sign(), '/src/secret.ts'), artifactId)).toHaveProperty('status', 404);
    expect(f.live.fetch).not.toHaveBeenCalled();
  });
  it('should authorize the websocket upgrade from the assertion on the exact endpoint', async () => {
    const f = fixture(); const path = '/_live/session/hmr';
    expect(await f.proxy.authorize(f.req(sign(), path, { headers: { origin } }), artifactId, true)).toBeDefined();
    expect(await f.proxy.authorize(f.req(sign(), path), artifactId, true)).toBeUndefined();
    expect(await f.proxy.authorize(f.req(undefined, path, { headers: { origin } }), artifactId, true)).toBeUndefined();
  });
});

describe('content host routing for the pages domain', () => {
  const unused = async () => { throw new Error('release path must not run'); };
  function hostFor(live: ReturnType<typeof createLiveProxy>) {
    return createContentHost({ baseDomain: 'content.example.test', enabled: () => true, live,
      grants: { issue: unused, verify: unused } as never, current: unused, activate: unused,
      acls: { getArtifactAcl: unused }, lifecycle: { stateOf: unused, canRead: unused } as never,
      publication: { getCurrent: unused, getRelease: unused }, blobs: { getBlob: unused } });
  }
  it('should serve only live routes on the pages domain and never a release', async () => {
    const f = fixture(); const h = hostFor(f.proxy);
    expect((await h.fetch(f.req(sign()))).status).toBe(200);
    expect((await h.fetch(f.req(undefined))).status).toBe(404);
    expect((await h.fetch(f.req(undefined, '/_reader/nonce'))).status).toBe(404);
    expect((await h.fetch(new Request(`https://${artifactId}.unknown.example/`, { headers: { [ASSERTION_HEADER]: sign() } }))).status).toBe(404);
  });
});
