import { createServer, type Server, type RequestListener } from 'node:http';
import { createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
import { qualificationNode } from '../src/data-plane-qualification-node.js';
import { FakeRuntimeAdapter, type RunSandboxOptions } from '../src/runtime-adapter.js';
import { runInNewContext } from 'node:vm';
import { once } from 'node:events';
import { forwardSandboxPort } from '../src/port-forward.js';
import { streamHelper } from './stream-helper.js';

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
    let command: readonly string[] = [], upstream!: Server;
    class Runtime extends FakeRuntimeAdapter {
      override async runSandbox(input: RunSandboxOptions) { command = input.command!; return super.runSandbox(input); }
    }
    for (const image of ['rootfs.erofs', 'qualification.erofs']) writeFileSync(join(directory, image), 'fixture');
    const fixture = qualificationNode(directory, directory, new Runtime());
    await fixture.start();
    // Execute the actual generated argv script, remapping only its filesystem and listen address.
    runInNewContext(command[2]!, { console: { log() {}, error() {} }, process: { on() {} }, require: (name: string) => {
      if (name === 'crypto') return { createHash };
      if (name === 'fs') return { writeFileSync: (path: string, bytes: string) => {
        expect(path).toBe('/workspace/ui/dist/index.html'); writeFileSync(join(directory, 'index.html'), bytes);
      } };
      if (name === 'http') return { createServer: (handler: RequestListener) => {
        upstream = createServer(handler); const listen = upstream.listen.bind(upstream);
        upstream.listen = ((port: number, host: string) => {
          expect([port, host]).toEqual([5173, '127.0.0.1']); return listen(join(directory, 'upstream'));
        }) as typeof upstream.listen;
        upstream.on('connection', track); return upstream;
      } };
      throw new Error('unexpected fixture module');
    } });
    const tls = qualificationCertificates(), keys = generateTicketKeyPair();
    const custody = new CustodyGuard(join(directory, 'wal'));
    const sandbox = { id: 'qualification', tenantId: 'sentropic', state: 'running', network: 'ports', poolOwned: false,
      ownership: { principalId: 'qualification', custodyEpoch: 1 } } as SandboxRecord;
    const forward = forwardSandboxPort('runsc', '--root=/private', sandbox.id, 5173, join(directory, 'forward'),
      streamHelper('sandbox', join(directory, 'upstream'), sockets));
    const data = createDataPlane({ custody, publicKey: createPublicKey(keys.publicKeyPem),
      sandbox: () => sandbox, target: () => forward.ready });
    const server = createAgentServer({ ca: tls.ca, ...tls.server }, (req, res, role) => { void data.http(req, res, role); });
    server.on('connection', track);
    server.on('upgrade', (req, socket, head) => { void data.upgrade(req, socket, head, agentRole(req) ?? ''); });
    try {
      if (!upstream.listening) await once(upstream, 'listening');
      const socketPath = join(directory, 'tls');
      await new Promise<void>(resolve => server.listen(socketPath, resolve));
      const results: string[] = [];
      await probeDataPlane({ socketPath, certificates: tls, uid: sandbox.id, checkTcp() {},
        report: name => { results.push(name); }, node: { keys, get ownership() { return sandbox.ownership; },
          async revoke() { custody.revoke('sentropic', sandbox.id, 2); sandbox.ownership = { ...sandbox.ownership, custodyEpoch: 2 }; } } });
      expect(results).toContain('mTLS refuses absent and untrusted client certificates');
      expect(results.filter(name => name.startsWith('refuse '))).toHaveLength(8);
      expect(results.filter(name => name.includes('within 250 ms'))).toHaveLength(2);
      expect(upstream.listening).toBe(true);
    } finally {
      forward.stop();
      for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),
        new Promise<void>(resolve => upstream.close(() => resolve()))]);
      await fixture.close();
      rmSync(directory, { recursive: true });
    }
  });
});
