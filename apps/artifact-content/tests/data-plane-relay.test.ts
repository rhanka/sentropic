import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDataPlane } from './data-plane-fixture';
import { createLiveProxy, type LiveRoute } from '../src/live';
import { createSupervisorRelay } from '../src/supervisor-relay';
import { podName } from '../../../api/src/services/artifacts/live/pods';
import { sealFrame } from '../../../api/src/services/artifacts/live/supervisor-frame';

const open: Awaited<ReturnType<typeof fakeDataPlane>>[] = [];
afterEach(async () => { for (const f of open.splice(0)) await f.close(); });
const fixture = async () => { const f = await fakeDataPlane(); open.push(f); return f; };
describe('data-plane receiving integrations', () => {
  it.each(['expiry', 'revocation'] as const)('should refuse live bytes when custody changes on %s during a post-fetch route check', async kind => {
    const f = await fixture(); f.setTtl(200);
    const route: LiveRoute = { storageScopeId: 'scope', artifactId: 'artifact', sessionId: 'session',
      expiresAt: Date.now() + 30_000, podName: '', podUid: 'uid', generation: 1, routeEpoch: 1, sourceRevision: 'rev' };
    route.podName = podName(route);
    let entered!: () => void; let release!: () => void; let checks = 0;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const live = createLiveProxy({ authorize: async () => route, current: async () => {
      if (++checks === 2) { entered(); await wait; } return true;
    }, watch: () => () => {}, admittedPath: async () => true }, { dataPlane: f.transport });
    const result = live.fetch(new Request('https://artifact.example/'), 'artifact'); await checking;
    if (kind === 'revocation') f.revoke(); else await new Promise(resolve => setTimeout(resolve, 220));
    release(); const response = await result;
    expect(response?.status).toBe(403); expect(await response?.text()).toBe('{"error":"custody_revoked"}');
    expect(f.watchers).toBe(0);
  });
  it('should serve live content through mTLS while stripping browser and upstream authority', async () => {
    const f = await fixture();
    const route: LiveRoute = { storageScopeId: 'scope', artifactId: 'artifact', sessionId: 'session',
      expiresAt: Date.now() + 30_000, podName: '', podUid: 'uid', generation: 1, routeEpoch: 1, sourceRevision: 'rev' };
    route.podName = podName(route);
    f.answer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'forged=1' }); res.end('<html>node</html>'); });
    const k8s = vi.fn();
    const live = createLiveProxy({ authorize: async () => route, current: async () => true,
      watch: () => () => {}, admittedPath: async () => true, fetch: k8s }, { dataPlane: f.transport, cspProfile: 'D7-A' });
    const response = await live.fetch(new Request('https://artifact.example/', {
      headers: { cookie: 'browser', authorization: 'browser', 'x-custody-token': 'forged' },
    }), 'artifact');
    expect(response?.status).toBe(200); expect(await response?.text()).toBe('<html>node</html>');
    expect(response?.headers.has('set-cookie')).toBe(false);
    expect(response?.headers.get('content-security-policy')).toContain("worker-src 'self' blob:");
    expect(f.received[0].headers.cookie).toBeUndefined(); expect(f.received[0].headers.authorization).toBeUndefined();
    expect(k8s).not.toHaveBeenCalled();
  });
  it('should verify supervisor frames before issuing custody and relay the exact bytes through the port route', async () => {
    const f = await fixture(); const keys = generateKeyPairSync('ed25519');
    const name = 'artifact-' + 'a'.repeat(40);
    const frame = sealFrame(keys.privateKey, { v: 1, id: 'frame', op: 'phase',
      fence: { generation: 1, sessionId: 'session', leaseEpoch: 1, routeEpoch: 1, podName: name, podUid: 'uid' },
      issuedAt: Date.now(), expiresAt: Date.now() + 30_000, args: { phase: 'stopped' } });
    const relay = createSupervisorRelay({ namespace: 'builders', publicKeys: [keys.publicKey], dataPlane: f.transport });
    const post = (bytes: Uint8Array) => new Request('https://internal/frame', { method: 'POST', body: new Uint8Array(bytes),
      headers: { 'content-type': 'application/octet-stream' } });
    expect((await relay.relay(post(new Uint8Array(100)), name)).status).toBe(403); expect(f.issues).toBe(0);
    let forwarded = Buffer.alloc(0);
    f.answer((req, res) => { req.on('data', chunk => { forwarded = Buffer.concat([forwarded, chunk]); }); req.once('end', () => res.end('reply')); });
    const response = await relay.relay(post(frame), name);
    expect(response.status).toBe(200); expect(await response.text()).toBe('reply');
    expect(forwarded).toEqual(frame); expect(f.received[0].url).toBe('/v1/ports/5173/_supervisor/v1/frame');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
