import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { networkIsolationProbe, networkTargets, tenantWitnessHost } from '../src/qualification-network.js';
import { requireIsolationResults } from '../src/isolation-probe.js';

describe('real-host network probes', () => {
  it.each(['refused', 'connected', 'timeout', 'dns', 'interface'])('should reject a network escape or unproven refusal (%s)', async mode => {
    let output = '';
    const modules = {
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
    requireIsolationResults(output, report, targets.length + 4);
    expect(report.mock.calls.every(([, ok]) => ok)).toBe(mode === 'refused');
  });
});
