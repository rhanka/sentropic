import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { qualificationNode } from './data-plane-qualification-node.js';
import { qualificationCertificates } from './qualification-certificates.js';
import { createAgentServer, agentRole } from './transport.js';
import { createDataPlane } from './data-plane.js';
import { probeDataPlane } from './data-plane-qualification-probes.js';
import { portsEnabled, runscDigest, nodeCapabilities, usePortsAvailability } from './network-policy.js';
import { PortsActivation } from './ports-activation.js';
import { copyFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { monitorPorts } from './ports-monitor.js';
import { waitForQualificationPort } from './qualification-runtime.js';
import { qualificationProcesses, assertQualificationProcessesGone } from './qualification-processes.js';
import type { RuntimeAdapter } from './runtime-adapter.js';

/** Production observer on private gate files; never edits k8s's switch/binary. */
export async function qualifyPortsSwitch(directory: string, socketsRoot: string, release: string, signal: AbortSignal, adapter?: RuntimeAdapter) {
  for (const mode of ['switch-closed', 'digest-mismatch'] as const) {
    const previous = { enabled: process.env.EXECUTION_NODE_PORTS_ENABLED, digest: process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 };
    const privateRoot = join(directory, mode); mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    const config = join(privateRoot, 'agent.env'), binary = join(privateRoot, 'runsc');
    const qualified = execFileSync('sh', ['-ec', 'command -v runsc'], { encoding: 'utf8', timeout: 1000 }).trim();
    copyFileSync(qualified, binary);
    writeFileSync(config, `EXECUTION_NODE_PORTS_ENABLED=true\nEXECUTION_NODE_PORTS_RUNSC_SHA256=${runscDigest(qualified)}\n`, { mode: 0o600 });
    const activation = new PortsActivation(config, binary);
    usePortsAvailability(() => activation.enabled);
    const fixture = qualificationNode(join(directory, mode), release, adapter);
    const sockets = new Set<Duplex>();
    let server: ReturnType<typeof createAgentServer> | undefined, stopMonitor = () => {};
    let processes: ReturnType<typeof qualificationProcesses> | undefined;
    try {
      const enabledDeadline = Date.now() + 5000;
      while (!portsEnabled()) { signal.throwIfAborted(); assert.ok(Date.now() < enabledDeadline, 'private switch activation deadline'); await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.ok(nodeCapabilities().supportedOps.includes('ports'));
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
          const target = mode === 'switch-closed' ? config : binary;
          writeFileSync(`${target}.next`, mode === 'switch-closed' ? 'EXECUTION_NODE_PORTS_ENABLED=false\n' : 'unqualified replacement');
          const at = Date.now(); renameSync(`${target}.next`, target); return at;
        } });
      assert.equal(portsEnabled(), false);
      assert.ok(!nodeCapabilities().supportedOps.includes('ports'));
      await assert.rejects(fixture.node.daemon.createSandbox({ spec: { network: 'ports', profile: 'live' } } as never),
        { code: 'ports_disabled', status: 409 });
      const deadline = Date.now() + 5000;
      while (box.state !== 'destroyed') {
        signal.throwIfAborted(); assert.ok(Date.now() < deadline, 'ports sandbox stop deadline');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      console.log(`PASS ${mode} 409 ports_disabled and sandbox destroyed`);
    } finally {
      activation.close(); usePortsAvailability(() => false);
      stopMonitor(); for (const socket of sockets) socket.destroy();
      await fixture.close();
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
      if (processes) assertQualificationProcessesGone(processes);
      process.env.EXECUTION_NODE_PORTS_ENABLED = previous.enabled;
      process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 = previous.digest;
      usePortsAvailability(() => process.env.EXECUTION_NODE_PORTS_ENABLED === 'true'
        && process.env.EXECUTION_NODE_PORTS_RUNSC_SHA256 === runscDigest());
    }
  }
}
