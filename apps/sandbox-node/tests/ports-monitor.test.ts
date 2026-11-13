import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorPorts } from '../src/ports-monitor.js';
import { createExecutionNode } from '../src/index.js';
afterEach(() => vi.useRealTimers());
describe('ports switch revocation', () => {
  it('should cut within 250ms before stopping sandboxes and retry a failed cleanup', async () => {
    vi.useFakeTimers();
    let enabled = true;
    const order: string[] = [];
    const stop = vi.fn(async () => { order.push('stop'); if (order.length === 2) throw new Error('busy'); });
    const close = monitorPorts(() => enabled, () => order.push('cut'), stop);
    await vi.advanceTimersByTimeAsync(100); expect(stop).not.toHaveBeenCalled();
    enabled = false;
    await vi.advanceTimersByTimeAsync(50); expect(order).toEqual(['cut', 'stop']);
    await vi.advanceTimersByTimeAsync(50); expect(stop).toHaveBeenCalledTimes(2);
    close();
  });
  it('should destroy live and unstarted ports sandboxes and release their slots', async () => {
    const node = createExecutionNode();
    const box = await node.daemon.createSandbox({ commandId: 'create', spec: { tenantId: 'immo', profile: 'live', network: 'ports',
      command: ['/bin/sleep', '60'], devScope: { kind: 'ui', writable: ['ui/**'], refused: [], source: { repo: 'r', path: 'p', commit: 'c' } },
      quotaMiB: 16, quotaInodes: 1024, baseMounts: [] }, ownership: { tenantId: 'immo' } } as never);
    await node.daemon.disablePorts();
    expect(box.state).toBe('destroyed'); expect(node.admission.reservedMiB('immo')).toBe(0);
  });
});
