import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createLiveUpgrade } from '../src/live-upgrade';
import type { LiveProxy, LiveRoute } from '../src/live';

const artifactId = '11111111-1111-4111-8111-111111111111';
const host = `${artifactId}.content.example`;
async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return (server.address() as { port: number }).port;
}
describe('same-origin HMR transport', () => {
  it('should strip credentials in a real upgrade and close the tunnel immediately on revocation', async () => {
    const sockets: Duplex[] = []; let revoke!: () => void;
    const received: Record<string, unknown>[] = [];
    const upstream = createServer();
    upstream.on('upgrade', (request, socket) => {
      sockets.push(socket); received.push(request.headers);
      const accept = createHash('sha1').update(request.headers['sec-websocket-key'] +
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`);
    });
    const port = await listen(upstream);
    const route = { artifactId, sessionId: 'session', expiresAt: Date.now() + 30_000 } as LiveRoute;
    const live = { authorize: vi.fn(async () => ({ route, upstream: `http://127.0.0.1:${port}`, path: '/' })),
      valid: vi.fn(async () => true), watch: vi.fn((_route, close) => { revoke = close; return vi.fn(); }) } as unknown as LiveProxy;
    const content = createServer(); content.on('upgrade', createLiveUpgrade({ live, baseDomain: 'content.example', enabled: () => true }));
    const contentPort = await listen(content);
    const client = connect(contentPort, '127.0.0.1'); sockets.push(client);
    try {
      const response = once(client, 'data');
      client.write(`GET /_live/session/hmr HTTP/1.1\r\nHost: ${host}\r\nOrigin: https://${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\nCookie: private-cookie\r\nAuthorization: private-auth\r\nX-Forwarded-For: private-address\r\n\r\n`);
      expect(String((await response)[0])).toContain('101 Switching Protocols');
      expect(received).toHaveLength(1);
      for (const name of ['cookie', 'authorization', 'origin', 'x-forwarded-for']) expect(received[0]).not.toHaveProperty(name);
      expect(live.authorize).toHaveBeenCalledWith(expect.any(Request), artifactId, true);
      const closed = once(client, 'close'); revoke(); await closed;
      expect(client.destroyed).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>(resolve => content.close(() => resolve())),
        new Promise<void>(resolve => upstream.close(() => resolve()))]);
    }
  });
  it('should reject unsupported websocket protocols before any worker connection', async () => {
    const live = { authorize: vi.fn() } as unknown as LiveProxy;
    const server = createServer(); server.on('upgrade', createLiveUpgrade({ live, baseDomain: 'content.example', enabled: () => true }));
    const port = await listen(server); const client = connect(port, '127.0.0.1');
    try {
      const response = once(client, 'data');
      client.write(`GET /_live/session/hmr HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: arbitrary\r\n\r\n`);
      expect(String((await response)[0])).toContain('404 Not Found'); expect(live.authorize).not.toHaveBeenCalled();
    } finally { client.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
