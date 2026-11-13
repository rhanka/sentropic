import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeDataPlane } from './data-plane-fixture';
import { createLiveProxy, type LiveRoute } from '../src/live';
import { createLiveUpgrade } from '../src/live-upgrade';
import { podName } from '../../../api/src/services/artifacts/live/pods';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const id = '11111111-1111-4111-8111-111111111111';
async function fixture(recheck?: { entered(): void; wait: Promise<void> }) {
  const f = await fakeDataPlane(); cleanup.push(() => f.close()); f.setTtl(700);
  const route: LiveRoute = { storageScopeId: 'scope', artifactId: id, sessionId: 'session',
    expiresAt: Date.now() + 60_000, podName: '', podUid: 'uid', generation: 1, routeEpoch: 1, sourceRevision: 'rev' };
  route.podName = podName(route);
  let checks = 0;
  const live = createLiveProxy({ authorize: async () => route, current: async () => {
    if (++checks === 2 && recheck) { recheck.entered(); await recheck.wait; }
    return true;
  },
    admittedPath: async () => true, watch: () => () => {} }, { dataPlane: f.transport });
  const server = createServer(); const clients: Socket[] = [];
  server.on('upgrade', createLiveUpgrade({ live, baseDomain: 'content.example', enabled: () => true }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { for (const client of clients) client.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const open = async () => {
    const client = connect((server.address() as { port: number }).port, '127.0.0.1'); clients.push(client);
    const first = once(client, 'data');
    client.write(`GET /_live/session/hmr?token=vite HTTP/1.1\r\nHost: ${id}.content.example\r\nOrigin: https://${id}.content.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\nCookie: browser-only\r\nX-Custody-Token: forged\r\n\r\n`);
    return { client, header: String((await first)[0]) };
  };
  return { f, open };
}
describe('custody-bound HMR', () => {
  it.each(['renewal', 'revocation'] as const)('should close HMR with WS 1008 on %s and issue fresh custody on reconnect', async kind => {
    const { f, open } = await fixture(); const { client, header } = await open();
    expect(header).toContain('101 Switching Protocols');
    expect(f.received[0].url).toBe('/v1/ports/5173/_live/session/hmr?token=vite');
    expect(f.received[0].headers.cookie).toBeUndefined();
    expect(f.received[0].headers['x-custody-token']).not.toBe('forged');
    const frame = once(client, 'data');
    if (kind === 'revocation') f.revoke();
    expect(Buffer.from((await frame)[0])).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xf0]));
    expect(f.watchers).toBe(0);
    const next = await open(); expect(next.header).toContain('101 Switching Protocols'); expect(f.issues).toBe(2);
  });
  it('should refuse wrong physical UID during the WS handshake', async () => {
    const { f, open } = await fixture(); f.setUid('wrong-physical');
    expect((await open()).header).toContain('403 Forbidden'); expect(f.watchers).toBe(0);
  });
  it('should refuse an upgrade revoked while the asynchronous route recheck is pending', async () => {
    let entered!: () => void; let release!: () => void;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const { f, open } = await fixture({ entered, wait });
    const response = open(); await checking; f.revoke(); release();
    expect((await response).header).toContain('403 Forbidden'); expect(f.watchers).toBe(0);
  });
});
