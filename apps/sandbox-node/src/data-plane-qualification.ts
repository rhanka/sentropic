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
import { QualificationDeadline, qualificationDeadline, qualificationCleanup } from './qualification-deadline.js';
import { assertNoQualificationLeftovers } from './qualification-leftovers.js';
import { createQualificationDirectory } from './qualification-storage.js';
import { qualificationDiagnostics } from './qualification-diagnostics.js';
import { waitForQualificationPort, qualificationFailureInventory } from './qualification-runtime.js';
import { RunscRuntimeAdapter } from './runtime-adapter.js';

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
  const timeout = qualificationDeadline();
  const unlock = await acquireNodeLock();
  const deadline = new QualificationDeadline(timeout);
  let directory: string | undefined, socketDirectory: string | undefined, fixture: ReturnType<typeof qualificationNode> | undefined;
  let server: ReturnType<typeof createAgentServer> | undefined;
  const sockets = new Set<Duplex>();
  let failed = false;
  let step = 'startup'; let uid: string | undefined;
  const diagnostic = qualificationDiagnostics();
  const stage = (name: string) => { step = name; diagnostic(name, 'begin'); };
  const report = (name: string) => { deadline.signal.throwIfAborted(); console.log(`PASS ${name}`); };
  try {
    const state = execFileSync('systemctl', ['show', 'execution-node.service', '--property=ActiveState', '--value'],
      { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }).trim();
    assert.equal(state, 'inactive', 'service must be stopped');
    assertCleanStartup();
    assertNoQualificationLeftovers(dirname(process.execPath));
    assert.match(execFileSync('findmnt', ['--noheadings', '--raw', '--output=SOURCE', '--mountpoint', '/var/lib/builder/tenants/sentropic'],
      { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }).trim(), /^\/dev\/loop[0-9]+$/);
    rmSync(marker); // Consume operator authorization once, under the service's shared flock.
    const baseline = tcpListeners();
    const checkTcp = () => { for (const listener of tcpListeners()) assert.ok(baseline.has(listener), 'new host TCP listener'); };
    directory = createQualificationDirectory(dirname(process.execPath), 'qd');
    socketDirectory = mkdtempSync('/run/execution-node/qd-');
    stage('sandbox launch');
    fixture = qualificationNode(directory, dirname(process.execPath), new RunscRuntimeAdapter('runsc', undefined, diagnostic));
    const sandbox = await fixture.start();
    uid = sandbox.id;
    deadline.monitor(() => {
      assert.equal(sandbox.state, 'running', 'sandbox exited before probes finished');
      assert.ok(sandbox.runtimeId); fixture!.node.adapter.assertRunning?.(sandbox.runtimeId);
    });
    report('real runsc sandbox started');
    stage('5173 readiness');
    await deadline.wait(waitForQualificationPort(uid, deadline.signal, diagnostic));
    const tls = qualificationCertificates();
    const data = createDataPlane({ diagnostic, custody: fixture.custody, publicKey: createPublicKey(fixture.keys.publicKeyPem),
      sandbox: (tenant, uid) => fixture!.node.daemon.peekSandbox(tenant, uid),
      target: async (box, port) => {
        assert.ok(box.runtimeId && fixture!.node.adapter.portTarget);
        const target = await fixture!.node.adapter.portTarget(box.runtimeId, port);
        assert.ok(target.socketPath.startsWith(`/run/execution-node/ports/${sandbox.id}/`));
        checkTcp(); return target;
      } });
    server = createAgentServer({ ca: tls.ca, ...tls.server }, (req, res, role) => { void data.http(req, res, role); });
    server.on('secureConnection', socket => diagnostic('TLS handshake + CN',
      `authorized=${socket.authorized} CN=${String(socket.getPeerCertificate().subject?.CN).slice(0, 80)}`));
    server.on('tlsClientError', () => diagnostic('TLS handshake refusal', 'client certificate rejected'));
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket, head) => { void data.upgrade(req, socket, head, agentRole(req) ?? ''); });
    const socketPath = join(socketDirectory, 'tls.sock');
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socketPath, resolve); });
    await deadline.wait(probeDataPlane({ socketPath, certificates: tls, uid: sandbox.id, node: fixture, report, checkTcp, signal: deadline.signal, diagnostic, stage }));
    checkTcp(); report('no host TCP listener opened');
    deadline.stopMonitoring();
    stage('authenticated lifecycle');
    await deadline.wait(fixture.lifecycle(deadline.signal)); report('authenticated GET / stop-202 progress / export / DELETE');
  } catch (error) {
    failed = true; console.error(`FAIL step=${step}:`, error instanceof Error ? error.message : 'unknown error');
    uid ??= fixture?.sandboxId;
    if (uid) qualificationFailureInventory(uid, diagnostic);
  }
  finally {
    deadline.abort(new Error('qualification finished'));
    deadline.stopMonitoring();
    diagnostic('cleanup', 'stopping qualification scope and removing private resources');
    try {
      for (const socket of sockets) socket.destroy();
      // Start runtime cleanup even if the TLS listener refuses to finish closing.
      const cleanup = [fixture?.close()];
      if (server) cleanup.push(new Promise<void>(resolve => server!.close(() => resolve())));
      try { await qualificationCleanup(async () => { await Promise.all(cleanup); }); }
      finally {
        if (socketDirectory) rmSync(socketDirectory, { recursive: true, force: true });
        if (directory) {
          assertCleanStartup(directory);
          rmSync(directory, { recursive: true, force: true });
          console.log('PASS empty runtime, scope and mount inventory after cleanup');
        }
      }
    } catch { failed = true; console.error('FAIL step=cleanup data-plane qualification cleanup'); }
    deadline.close(); unlock();
  }
  if (failed || deadline.cancelled) throw new Error('data-plane qualification failed');
}
