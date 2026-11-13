import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { qualificationNode } from './data-plane-qualification-node.js';
import { qualificationCertificates } from './qualification-certificates.js';
import { createAgentServer, agentRole } from './transport.js';
import { createDataPlane } from './data-plane.js';
import { probeDataPlane } from './data-plane-qualification-probes.js';
import { portsEnabled } from './network-policy.js';
import { monitorPorts } from './ports-monitor.js';
import { waitForQualificationPort } from './qualification-runtime.js';
import { qualificationProcesses, assertQualificationProcessesGone } from './qualification-processes.js';

/** Uses only isolated in-memory settings; never opens k8s's production switch. */
export async function qualifyPortsSwitch(directory: string, socketsRoot: string, release: string, signal: AbortSignal) {
  for (const mode of ['switch-closed', 'digest-mismatch'] as const) {
    const previous = { enabled: process.env.EXECUTION_NODE_PORTS_ENABLED, digest: process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 };
    const fixture = qualificationNode(join(directory, mode), release);
    const sockets = new Set<Duplex>();
    let server: ReturnType<typeof createAgentServer> | undefined, stopMonitor = () => {};
    let processes: ReturnType<typeof qualificationProcesses> | undefined;
    try {
      const box = await fixture.start();
      processes = qualificationProcesses(box.id);
      await waitForQualificationPort(box.id, signal, () => {});
      const tls = qualificationCertificates();
      const data = createDataPlane({ custody: fixture.custody, publicKey: createPublicKey(fixture.keys.publicKeyPem), portsEnabled,
        sandbox: (tenant, uid) => fixture.node.daemon.peekSandbox(tenant, uid),
        target: (box, port) => fixture.node.adapter.portTarget!(box.runtimeId!, port) });
      stopMonitor = monitorPorts(portsEnabled, () => data.cutPorts(), () => fixture.node.daemon.disablePorts());
      server = createAgentServer({ ca: tls.ca, ...tls.server }, (req, res, role) => { void data.http(req, res, role); });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      server.on('upgrade', (req, socket, head) => { void data.upgrade(req, socket, head, agentRole(req) ?? ''); });
      const socketPath = join(socketsRoot, `${mode}.sock`);
      await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socketPath, resolve); });
      await probeDataPlane({ socketPath, certificates: tls, uid: box.id, node: fixture, signal, switchMode: mode,
        report: name => console.log(`PASS ${mode} ${name}`), checkTcp() {},
        closeSwitch() {
          if (mode === 'switch-closed') process.env.EXECUTION_NODE_PORTS_ENABLED = 'false';
          else process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 = '0'.repeat(64);
        } });
      assert.equal(portsEnabled(), false);
      await assert.rejects(fixture.node.daemon.createSandbox({ spec: { network: 'ports', profile: 'live' } } as never),
        { code: 'ports_disabled', status: 409 });
      const deadline = Date.now() + 5000;
      while (box.state !== 'destroyed') {
        signal.throwIfAborted(); assert.ok(Date.now() < deadline, 'ports sandbox stop deadline');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      console.log(`PASS ${mode} 409 ports_disabled and sandbox destroyed`);
    } finally {
      stopMonitor(); for (const socket of sockets) socket.destroy();
      await fixture.close();
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
      if (processes) assertQualificationProcessesGone(processes);
      process.env.EXECUTION_NODE_PORTS_ENABLED = previous.enabled;
      process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 = previous.digest;
    }
  }
}
