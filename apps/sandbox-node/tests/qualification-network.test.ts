import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { networkIsolationProbe, networkProbeCount, networkTargets, tenantWitnessHost } from '../src/qualification-network.js';
import { requireIsolationResults } from '../src/isolation-probe.js';

describe('real-host network probes', () => {
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
