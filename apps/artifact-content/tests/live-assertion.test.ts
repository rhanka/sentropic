import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createHostAssertionLive, createLiveFences } from '../src/live-assertion';
import {
  ASSERTION_HEADER, CONTROL_HEADER, FENCE_HEADER, MAX_SOURCE_REVISION_LENGTH, signLiveAssertion, signLiveControl, signLiveFence,
  type LiveAssertionClaims, type LiveControlClaims, type LiveFenceClaims,
} from '@sentropic/artifacts/live-host';
import { createContentHost } from '../src/host';
import { createLiveProxy, LIVE_CONTROL_PATH, LIVE_FENCE_PATH } from '../src/live';
import { podName } from '../../../api/src/services/artifacts/live/pods';

const artifactId = '11111111-1111-4111-8111-111111111111';
const pagesDomain = 'pages.immo.example';
const host = `${artifactId}.${pagesDomain}`;
const origin = `https://${host}`;
const key = Buffer.alloc(32, 7);
const controllerKey = Buffer.alloc(32, 5);
const t0 = 1_000_000;
function claims(over: Partial<LiveAssertionClaims> = {}): LiveAssertionClaims {
  const base = { v: 1 as const, kid: 'immo-1', host, artifactId, storageScopeId: 'scope', sessionId: 'session',
    generation: 1, routeEpoch: 1, podUid: 'uid', podName: '', sourceRevision: 'gen:1/rev:3', principalId: 'owner',
    role: 'binding_owner' as const, invitationId: '', invitationEpoch: 0, invitationExp: 0,
    iat: t0 / 1000, exp: t0 / 1000 + 600, ...over };
  base.podName = over.podName ?? podName(base);
  return base;
}
function fixture(time = { now: t0 }) {
  const fences = createLiveFences({ now: () => time.now });
  const admittedPath = vi.fn(async () => true);
  const live = createHostAssertionLive({ hosts: [{ pagesDomain, keyIds: ['immo-1'] }],
    key: kid => kid === 'immo-1' ? key : undefined, fences, admittedPath, now: () => time.now,
    controller: { keyIds: ['sentropic-1'], key: kid => kid === 'sentropic-1' ? controllerKey : undefined },
    fetch: vi.fn(async () => new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } })) });
  const proxy = createLiveProxy(live);
  const req = (token: string | undefined, path = '/', init: RequestInit = {}) => new Request(origin + path,
    { ...init, headers: { ...(token ? { [ASSERTION_HEADER]: token } : {}), ...(init.headers as object) } });
  return { fences, admittedPath, live, proxy, req, time };
}
const sign = (c = claims(), k = key) => signLiveAssertion(c, k);

/** A correctly keyed `v1` token over arbitrary claims, as a signer still emitting a numeric revision would. */
function raw(body: object, k = key) {
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `v1.${encoded}.${createHmac('sha256', k).update(`v1.${encoded}`).digest('base64url')}`;
}
describe('signed host assertion at the edge (wire format owned by @sentropic/artifacts/live-host)', () => {
  it('should carry the opaque source revision into the route unchanged', async () => {
    const f = fixture();
    for (const sourceRevision of ['gen:1/rev:3', '8f14e45fceea167a', 'x'.repeat(MAX_SOURCE_REVISION_LENGTH)]) {
      expect((await f.live.authorize(f.req(sign(claims({ sourceRevision }))), artifactId))?.sourceRevision).toBe(sourceRevision);
    }
  });
  it('should refuse a numeric, empty or over-long revision even under a listed key', async () => {
    const f = fixture();
    expect(await f.live.authorize(f.req(raw(claims())), artifactId)).toBeDefined();
    for (const sourceRevision of [3, '', 'x'.repeat(MAX_SOURCE_REVISION_LENGTH + 1)]) {
      expect(await f.live.authorize(f.req(raw(claims({ sourceRevision } as never))), artifactId)).toBeUndefined();
    }
  });
  it('should refuse a tampered, foreign-key or expired assertion', async () => {
    const f = fixture(); const [v, , mac] = sign().split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims(), principalId: 'attacker' })).toString('base64url');
    for (const bad of [`${v}.${forged}.${mac}`, sign(claims(), Buffer.alloc(32, 9)), sign(claims({ exp: t0 / 1000 - 1 }))]) {
      expect(await f.live.authorize(f.req(bad), artifactId)).toBeUndefined();
    }
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
    const fresh = await f.live.authorize(f.req(sign(claims({ sessionId: 'session-2', generation: 2, routeEpoch: 3 }))), artifactId);
    expect(fresh).toBeDefined();
  });
  it('should delegate source admission to the host manifest port', async () => {
    const f = fixture(); f.admittedPath.mockResolvedValueOnce(false);
    expect(await f.proxy.fetch(f.req(sign(), '/src/secret.ts'), artifactId)).toBeUndefined(); // the pages host answers 404
    expect(f.live.fetch).not.toHaveBeenCalled();
  });
  it('should authorize the websocket upgrade from the assertion on the exact endpoint', async () => {
    const f = fixture(); const path = '/_live/session/hmr';
    expect(await f.proxy.authorize(f.req(sign(), path, { headers: { origin } }), artifactId, true)).toBeDefined();
    expect(await f.proxy.authorize(f.req(sign(), path), artifactId, true)).toBeUndefined();
    expect(await f.proxy.authorize(f.req(undefined, path, { headers: { origin } }), artifactId, true)).toBeUndefined();
  });
});

const invitee = (over: Partial<LiveAssertionClaims> = {}) => claims({ principalId: 'guest', role: 'invitee', invitationId: 'inv-1',
  invitationEpoch: 1, invitationExp: t0 / 1000 + 900, ...over });
describe('invitee role (multi-user live)', () => {
  it('should carry principal, role, invitation id, epoch and expiry into the route', async () => {
    const f = fixture(); const route = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    expect(route).toMatchObject({ role: 'invitee', principalId: 'guest', invitationId: 'inv-1', invitationEpoch: 1, sessionId: 'session', generation: 1 });
    const owner = (await f.live.authorize(f.req(sign()), artifactId))!;
    expect(owner).toMatchObject({ role: 'binding_owner', principalId: 'owner' }); expect(owner.invitationId).toBeUndefined();
  });
  it('should cap the route lifetime at the invitation expiry', async () => {
    const f = fixture(); const route = (await f.live.authorize(f.req(sign(invitee({ invitationExp: t0 / 1000 + 100, exp: t0 / 1000 + 100 }))), artifactId))!;
    expect(route.expiresAt).toBe(t0 + 100_000);
  });
  it.each([
    ['unknown role', { role: 'admin' }], ['owner carrying an invitation', { invitationId: 'inv-1' }],
    ['invitee without invitation id', { role: 'invitee', invitationId: '', invitationEpoch: 1, invitationExp: t0 / 1000 + 900 }],
    ['invitee expired invitation', { role: 'invitee', invitationId: 'i', invitationEpoch: 1, invitationExp: t0 / 1000 - 1 }],
    ['assertion outliving invitation', { role: 'invitee', invitationId: 'i', invitationEpoch: 1, invitationExp: t0 / 1000 + 10 }],
    ['invitee epoch zero', { role: 'invitee', invitationId: 'i', invitationEpoch: 0, invitationExp: t0 / 1000 + 900 }],
  ])('should refuse %s at the edge', async (_n, over) => {
    const f = fixture(); expect(await f.live.authorize(f.req(sign(claims(over as Partial<LiveAssertionClaims>))), artifactId)).toBeUndefined();
  });
  it('should close invitee sockets on invitation revocation without touching the owner or other invitations', async () => {
    const f = fixture(); const guest = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    const other = (await f.live.authorize(f.req(sign(invitee({ invitationId: 'inv-2' }))), artifactId))!;
    const owner = (await f.live.authorize(f.req(sign()), artifactId))!;
    const closeGuest = vi.fn(); const closeOther = vi.fn(); const closeOwner = vi.fn();
    f.live.watch(guest, closeGuest); f.live.watch(other, closeOther); f.live.watch(owner, closeOwner);
    f.fences.revokeInvitation({ artifactId, invitationId: 'inv-1', epoch: 2 });
    expect(closeGuest).toHaveBeenCalledTimes(1); expect(closeOther).not.toHaveBeenCalled(); expect(closeOwner).not.toHaveBeenCalled();
    expect(await f.live.current(guest)).toBe(false); expect(await f.live.current(owner)).toBe(true);
    expect(await f.live.authorize(f.req(sign(invitee())), artifactId)).toBeUndefined();
    expect(await f.live.authorize(f.req(sign(invitee({ invitationEpoch: 2 }))), artifactId)).toBeDefined();
  });
  it('should close an invitee socket when the session is revoked or a new generation is fenced', async () => {
    const f = fixture(); const guest = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    const close = vi.fn(); f.live.watch(guest, close);
    f.fences.fence({ artifactId, generation: 2, routeEpoch: 1 }); expect(close).toHaveBeenCalledTimes(1);
  });
  it('should expire an invitee through the proxy validity check', async () => {
    const f = fixture(); const guest = (await f.live.authorize(f.req(sign(invitee({ invitationExp: t0 / 1000 + 100, exp: t0 / 1000 + 100 }))), artifactId))!;
    expect(await f.proxy.valid(guest)).toBe(true); f.time.now = t0 + 101_000; expect(await f.proxy.valid(guest)).toBe(false);
  });
  it('should authorize the invitee websocket upgrade and serve HTML to the invitee', async () => {
    const f = fixture(); const path = '/_live/session/hmr';
    expect(await f.proxy.authorize(f.req(sign(invitee()), path, { headers: { origin } }), artifactId, true)).toBeDefined();
    expect((await f.proxy.fetch(f.req(sign(invitee())), artifactId))?.status).toBe(200);
  });
});

describe('session-bound live authorization record', () => {
  it('should bind a session to one owner principal and one generation', async () => {
    const f = fixture(); expect(await f.live.authorize(f.req(sign()), artifactId)).toBeDefined();
    expect(await f.live.authorize(f.req(sign(claims({ principalId: 'intruder' }))), artifactId)).toBeUndefined();
    expect(await f.live.authorize(f.req(sign(claims({ generation: 2 }))), artifactId)).toBeUndefined();
    expect(await f.live.authorize(f.req(sign(claims({ sessionId: 'session-2', generation: 2 }))), artifactId)).toBeDefined();
  });
  it('should bind an invitation to one principal and one session', async () => {
    const f = fixture(); expect(await f.live.authorize(f.req(sign(invitee())), artifactId)).toBeDefined();
    expect(await f.live.authorize(f.req(sign(invitee({ principalId: 'copied' }))), artifactId)).toBeUndefined();
    expect(await f.live.authorize(f.req(sign(invitee({ sessionId: 'session-2' }))), artifactId)).toBeUndefined();
  });
  it('should take a newer invitation epoch as its floor and close the older epoch sockets', async () => {
    const f = fixture(); const old = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    const close = vi.fn(); f.live.watch(old, close);
    expect(await f.live.authorize(f.req(sign(invitee({ invitationEpoch: 2 }))), artifactId)).toBeDefined();
    expect(close).toHaveBeenCalledTimes(1); expect(await f.live.authorize(f.req(sign(invitee())), artifactId)).toBeUndefined();
  });
  it('should forget a session record once every assertion for it has expired', async () => {
    const f = fixture(); expect(await f.live.authorize(f.req(sign()), artifactId)).toBeDefined();
    f.time.now = t0 + 601_000; const later = { iat: t0 / 1000 + 601, exp: t0 / 1000 + 1200 };
    expect(await f.live.authorize(f.req(sign(claims({ ...later, principalId: 'next-owner' }))), artifactId)).toBeDefined();
  });
});

const control = (over: Partial<LiveControlClaims> = {}): LiveControlClaims => ({ v: 1, kid: 'immo-1', host, artifactId,
  op: 'revoke_invitation', sessionId: '', invitationId: 'inv-1', epoch: 2, iat: t0 / 1000, exp: t0 / 1000 + 60, ...over });
const post = (token?: string, path = LIVE_CONTROL_PATH, method = 'POST') => new Request(origin + path,
  { method, headers: token ? { [CONTROL_HEADER]: token } : {} });
describe('host push path: signed revocation', () => {
  it('should close sockets on a signed invitation revocation and refuse a revoked session', async () => {
    const f = fixture(); const guest = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    const owner = (await f.live.authorize(f.req(sign()), artifactId))!;
    const closeGuest = vi.fn(); const closeOwner = vi.fn(); f.live.watch(guest, closeGuest); f.live.watch(owner, closeOwner);
    expect((await f.live.control(post(signLiveControl(control(), key)), artifactId))?.status).toBe(204);
    expect(closeGuest).toHaveBeenCalledTimes(1); expect(closeOwner).not.toHaveBeenCalled();
    const stop = control({ op: 'revoke_session', sessionId: 'session', invitationId: '', epoch: 0 });
    expect((await f.live.control(post(signLiveControl(stop, key)), artifactId))?.status).toBe(204);
    expect(closeOwner).toHaveBeenCalledTimes(1); expect(await f.live.authorize(f.req(sign()), artifactId)).toBeUndefined();
  });
  it.each([
    ['no token', () => post()],
    ['a GET', () => post(signLiveControl(control(), key), LIVE_CONTROL_PATH, 'GET')],
    ['a query string', () => post(signLiveControl(control(), key), `${LIVE_CONTROL_PATH}?x=1`)],
    ['an assertion used as control', () => post(sign())],
    ['a controller fence used as control', () => post(signLiveFence(fence(), key))],
    ['a controller key', () => post(signLiveControl(control({ kid: 'sentropic-1' }), controllerKey))],
    ['a wrong host', () => post(signLiveControl(control({ host: `x.${pagesDomain}` }), key))],
    ['a wrong artifact', () => post(signLiveControl(control({ artifactId: '22222222-2222-4222-8222-222222222222' }), key))],
    ['an unlisted key id', () => post(signLiveControl(control({ kid: 'other' }), key))],
    ['a wrong key', () => post(signLiveControl(control(), Buffer.alloc(32, 9)))],
    ['an invitation revocation naming a session', () => post(signLiveControl(control({ sessionId: 'session' }), key))],
    ['epoch zero', () => post(signLiveControl(control({ epoch: 0 }), key))],
    ['a fractional epoch', () => post(signLiveControl(control({ epoch: 1.5 }), key))],
    ['a fence op from the host', () => post(signLiveControl(control({ op: 'fence' as never, invitationId: '', epoch: 0 }), key))],
    ['an expired message', () => post(signLiveControl(control({ exp: t0 / 1000 }), key))],
    ['an over-long message', () => post(signLiveControl(control({ exp: t0 / 1000 + 301 }), key))],
  ])('should refuse %s with no effect', async (_name, build) => {
    const f = fixture(); const guest = (await f.live.authorize(f.req(sign(invitee())), artifactId))!;
    const close = vi.fn(); f.live.watch(guest, close);
    expect(await f.live.control(build(), artifactId)).toBeUndefined();
    expect(close).not.toHaveBeenCalled(); expect(await f.live.current(guest)).toBe(true);
  });
});

function fence(over: Partial<LiveFenceClaims> = {}): LiveFenceClaims {
  return { v: 1, kid: 'sentropic-1', artifactId, generation: 1, routeEpoch: 2, iat: t0 / 1000, exp: t0 / 1000 + 60, ...over };
}
const internal = 'https://artifact-content.sentropic.svc.cluster.local:8791';
const push = (token?: string, base = internal, path = LIVE_FENCE_PATH, init: { method?: string; headers?: Headers } = {}) => {
  const headers = init.headers ?? new Headers(token ? { [FENCE_HEADER]: token } : {});
  return new Request(base + path, { method: init.method ?? 'POST', headers });
};
describe('controller push path: signed generation and route-epoch fences', () => {
  it('should close older routes and refuse them afterwards', async () => {
    const f = fixture(); const owner = (await f.live.authorize(f.req(sign()), artifactId))!;
    const close = vi.fn(); f.live.watch(owner, close);
    expect((await f.live.fence(push(signLiveFence(fence(), controllerKey))))?.status).toBe(204);
    expect(close).toHaveBeenCalledTimes(1); expect(await f.live.current(owner)).toBe(false);
    expect(await f.live.authorize(f.req(sign(claims({ sessionId: 'session-2', routeEpoch: 2 }))), artifactId)).toBeDefined();
  });
  it.each([
    ['no token', () => push()],
    ['a GET', () => push(signLiveFence(fence(), controllerKey), internal, LIVE_FENCE_PATH, { method: 'GET' })],
    ['a query string', () => push(signLiveFence(fence(), controllerKey), internal, `${LIVE_FENCE_PATH}?x=1`)],
    ['a duplicate header', () => {
      const headers = new Headers(); const token = signLiveFence(fence(), controllerKey);
      headers.append(FENCE_HEADER, token); headers.append(FENCE_HEADER, token);
      return push(undefined, internal, LIVE_FENCE_PATH, { headers });
    }],
    ['a pages-domain host', () => push(signLiveFence(fence(), controllerKey), origin)],
    ['a host key', () => push(signLiveFence(fence({ kid: 'immo-1' }), key))],
    ['a host control used as fence', () => push(signLiveControl(control(), controllerKey))],
    ['an unlisted controller key id', () => push(signLiveFence(fence({ kid: 'other' }), controllerKey))],
    ['generation zero', () => push(signLiveFence(fence({ generation: 0 }), controllerKey))],
    ['an over-long message', () => push(signLiveFence(fence({ exp: t0 / 1000 + 301 }), controllerKey))],
  ])('should refuse %s with no effect', async (_name, build) => {
    const f = fixture(); const owner = (await f.live.authorize(f.req(sign()), artifactId))!;
    const close = vi.fn(); f.live.watch(owner, close);
    expect(await f.live.fence(build())).toBeUndefined();
    expect(close).not.toHaveBeenCalled(); expect(await f.live.current(owner)).toBe(true);
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
  it('should route the host push path on the pages domain only', async () => {
    const f = fixture(); const h = hostFor(f.proxy);
    expect((await h.fetch(post(signLiveControl(control(), key)))).status).toBe(204);
    expect((await h.fetch(post())).status).toBe(404);
  });
  it('should route the controller push path on the internal Host only, never on a public content host', async () => {
    const f = fixture(); const h = hostFor(f.proxy); const token = signLiveFence(fence(), controllerKey);
    expect((await h.fetch(push(token, 'https://content.example.test'))).status).toBe(404);
    expect((await h.fetch(push(token, 'https://x.content.example.test'))).status).toBe(404);
    expect((await h.fetch(push(token))).status).toBe(204);
    expect((await h.fetch(push())).status).toBe(404);
  });
});
