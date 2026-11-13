import { createServer } from 'node:http';
import { createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { qualificationCertificates } from '../src/qualification-certificates.js';
import { qualifyDataPlane } from '../src/data-plane-qualification.js';
import { probeDataPlane } from '../src/data-plane-qualification-probes.js';
import { generateTicketKeyPair } from '../src/tickets.js';
import { createDataPlane } from '../src/data-plane.js';
import { createAgentServer, agentRole } from '../src/transport.js';
import { CustodyGuard } from '../src/custody.js';
import type { SandboxRecord } from '../src/daemon.js';

describe('data-plane qualification harness (hermetic; real-host gate remains operator-owned)', () => {
  it('should refuse to touch the host without isolated qualification authorization', async () => {
    const previous = process.env.QUALIFICATION_ONLY; delete process.env.QUALIFICATION_ONLY;
    try { await expect(qualifyDataPlane()).rejects.toThrow('isolated qualification host required'); }
    finally { if (previous !== undefined) process.env.QUALIFICATION_ONLY = previous; }
  });
  it('should exercise mTLS, HTTP/WS refusal matrix and bounded cuts using private test UDS', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qd-'));
    const sockets = new Set<Duplex>();
    const track = (socket: Duplex) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
    const upstream = createServer((_req, res) => { res.writeHead(200); res.write('qualification-stream'); });
    upstream.on('connection', track);
    upstream.on('upgrade', (req, socket) => {
      const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    });
    const tls = qualificationCertificates(), keys = generateTicketKeyPair();
    const custody = new CustodyGuard(join(directory, 'wal'));
    const sandbox = { id: 'qualification', tenantId: 'sentropic', state: 'running', network: 'ports', poolOwned: false,
      ownership: { principalId: 'qualification', custodyEpoch: 1 } } as SandboxRecord;
    const data = createDataPlane({ custody, publicKey: createPublicKey(keys.publicKeyPem),
      sandbox: () => sandbox, target: async () => ({ socketPath: join(directory, 'upstream') }) });
    const server = createAgentServer({ ca: tls.ca, ...tls.server }, (req, res, role) => { void data.http(req, res, role); });
    server.on('connection', track);
    server.on('upgrade', (req, socket, head) => { void data.upgrade(req, socket, head, agentRole(req) ?? ''); });
    try {
      await new Promise<void>(resolve => upstream.listen(join(directory, 'upstream'), resolve));
      const socketPath = join(directory, 'tls');
      await new Promise<void>(resolve => server.listen(socketPath, resolve));
      const results: string[] = [];
      await probeDataPlane({ socketPath, certificates: tls, uid: sandbox.id, checkTcp() {},
        report: name => { results.push(name); }, node: { keys, get ownership() { return sandbox.ownership; },
          async revoke() { custody.revoke('sentropic', sandbox.id, 2); sandbox.ownership = { ...sandbox.ownership, custodyEpoch: 2 }; } } });
      expect(results).toContain('mTLS refuses absent and untrusted client certificates');
      expect(results.filter(name => name.startsWith('refuse '))).toHaveLength(8);
      expect(results.filter(name => name.includes('within 250 ms'))).toHaveLength(2);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),
        new Promise<void>(resolve => upstream.close(() => resolve()))]);
      rmSync(directory, { recursive: true });
    }
  });
});
