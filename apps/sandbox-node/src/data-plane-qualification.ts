import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { acquireNodeLock } from './node-lock.js';
import { assertCleanStartup } from './restart.js';
import { createAgentServer, agentRole } from './transport.js';
import { createDataPlane } from './data-plane.js';
import { createPublicKey } from 'node:crypto';
import { qualificationCertificates } from './qualification-certificates.js';
import { qualificationNode } from './data-plane-qualification-node.js';
import { probeDataPlane } from './data-plane-qualification-probes.js';

function tcpListeners() {
  return new Set(['/proc/net/tcp', '/proc/net/tcp6'].flatMap(path => readFileSync(path, 'utf8').trim().split('\n').slice(1)
    .map(line => line.trim().split(/\s+/)).filter(row => row[3] === '0A').map(row => `${path}:${row[1]}`)));
}

/** Operator-only real-host qualification; never imports service.ts or production keys/state. */
export async function qualifyDataPlane(): Promise<void> {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated', 'isolated qualification host required');
  assert.equal(process.getuid?.(), 0, 'root required');
  const marker = '/etc/execution-node/isolated-qualification';
  assert.ok(existsSync(marker), 'isolated qualification marker required');
  const unlock = await acquireNodeLock();
  let directory: string | undefined, fixture: ReturnType<typeof qualificationNode> | undefined;
  let server: ReturnType<typeof createAgentServer> | undefined;
  const sockets = new Set<Duplex>();
  let interrupted = false, failed = false;
  const interrupt = () => { interrupted = true; };
  const report = (name: string) => { assert.ok(!interrupted, 'qualification interrupted'); console.log(`PASS ${name}`); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const state = execFileSync('systemctl', ['show', 'execution-node.service', '--property=ActiveState', '--value'],
      { encoding: 'utf8', timeout: 5000 }).trim();
    assert.equal(state, 'inactive', 'service must be stopped');
    assertCleanStartup();
    assert.match(execFileSync('findmnt', ['--noheadings', '--raw', '--output=SOURCE', '--mountpoint', '/var/lib/builder/tenants/sentropic'],
      { encoding: 'utf8', timeout: 5000 }).trim(), /^\/dev\/loop[0-9]+$/);
    rmSync(marker); // Consume operator authorization once, under the service's shared flock.
    const baseline = tcpListeners();
    const checkTcp = () => { for (const listener of tcpListeners()) assert.ok(baseline.has(listener), 'new host TCP listener'); };
    directory = mkdtempSync('/run/execution-node/qd-');
    fixture = qualificationNode(directory, dirname(process.execPath));
    const sandbox = await fixture.start(); report('real runsc sandbox started');
    const tls = qualificationCertificates();
    const data = createDataPlane({ custody: fixture.custody, publicKey: createPublicKey(fixture.keys.publicKeyPem),
      sandbox: (tenant, uid) => fixture!.node.daemon.peekSandbox(tenant, uid),
      target: async (box, port) => {
        assert.ok(box.runtimeId && fixture!.node.adapter.portTarget);
        const target = await fixture!.node.adapter.portTarget(box.runtimeId, port);
        assert.ok(target.socketPath.startsWith(`/run/execution-node/ports/${sandbox.id}/`));
        checkTcp(); return target;
      } });
    server = createAgentServer({ ca: tls.ca, ...tls.server }, (req, res, role) => { void data.http(req, res, role); });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket, head) => { void data.upgrade(req, socket, head, agentRole(req) ?? ''); });
    const socketPath = join(directory, 'tls.sock');
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socketPath, resolve); });
    await probeDataPlane({ socketPath, certificates: tls, uid: sandbox.id, node: fixture, report, checkTcp });
    checkTcp(); report('no host TCP listener opened');
    await fixture.lifecycle(); report('authenticated GET / stop-202 progress / export / DELETE');
  } catch { failed = true; console.error('FAIL real-host data-plane execution'); }
  finally {
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    try {
      await fixture?.close();
      if (directory) { assertCleanStartup(); report('empty runtime, scope and mount inventory after cleanup'); rmSync(directory, { recursive: true }); }
    } catch { failed = true; console.error('FAIL data-plane qualification cleanup'); }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); unlock();
  }
  if (failed || interrupted) throw new Error('data-plane qualification failed');
}
