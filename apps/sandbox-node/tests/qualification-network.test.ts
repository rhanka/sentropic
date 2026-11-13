import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { networkIsolationProbe, networkProbeCount, networkTargets, tenantWitnessHost, tenantWitnessScript, tenantWitnessCheck } from '../src/qualification-network.js';
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { requireIsolationResults } from '../src/isolation-probe.js';

describe('real-host network probes', () => {
  it('should positively control TCP/UDP witnesses and reject a delivered cross-tenant datagram', async () => {
    const child = spawn(process.execPath, ['-e', tenantWitnessScript('immo')], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw new Error('witness exited'); })]);
      const check = () => spawnSync(process.execPath, ['-e', tenantWitnessCheck('immo')], { timeout: 1000 });
      expect(check().status).toBe(0);
      const udp = createSocket('udp4');
      try { const response = once(udp, 'message'); udp.send('qualification', 5173, tenantWitnessHost('immo')); await response; }
      finally { udp.close(); }
      expect(check().status).not.toBe(0);
    } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited; }
  });
  it.each(['refused', 'connected', 'timeout', 'dns', 'interface', 'udp', 'raw', 'packet'])('should reject a network escape or unproven refusal (%s)', async mode => {
    let output = '';
    const modules = {
      'node:child_process': { execFileSync: (_path: string, args: string[]) => {
        if (args[0]!.startsWith('udp')) { if (mode === 'udp') throw new Error('send accepted'); return ''; }
        return JSON.stringify([{ name: 'raw socket refused', ok: mode !== 'raw' }, { name: 'packet socket refused', ok: mode !== 'packet' }]);
      } },
      'node:net': { connect: () => {
        const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout(_ms: number, fn: () => void) {
          if (mode === 'timeout') queueMicrotask(fn);
        } });
        if (mode !== 'timeout') queueMicrotask(() => socket.emit(mode === 'connected' ? 'connect' : 'error', { code: 'ENETUNREACH' }));
        return socket;
      } },
      'node:os': { networkInterfaces: () => mode === 'interface' ? { lo: [], eth0: [] } : { lo: [] } },
      'node:dns': { Resolver: class {
        setServers() {}
        resolve4(_name: string, callback: (e: unknown, addresses?: string[]) => void) {
          callback(mode === 'dns' ? null : new Error('unreachable'), mode === 'dns' ? ['1.2.3.4'] : undefined);
        }
      } },
    };
    const targets = networkTargets(['15.235.44.193'], tenantWitnessHost('immo'));
    expect(targets).toContainEqual(['15.235.44.193', 22]);
    expect(targets).toContainEqual(['15.235.44.193', 8443]);
    expect(targets).toContainEqual(['127.77.0.3', 5173]);
    await runInNewContext(networkIsolationProbe(targets), { require: (name: keyof typeof modules) => modules[name],
      process: { stdout: { write: (value: string) => { output = value; } } } });
    const report = vi.fn();
    requireIsolationResults(output, report, networkProbeCount(targets));
    expect(report.mock.calls.every(([, ok]) => ok)).toBe(mode === 'refused');
  });
});
