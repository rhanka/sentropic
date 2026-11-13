import { describe, expect, it } from 'vitest';
import { createExecutionNode, FakeRuntimeAdapter, ExecutionNodeError } from '../src/index.js';
import type { RunSandboxOptions } from '../src/runtime-adapter.js';

describe('isolation violation cleanup retention', () => {
  it('should audit immediately and retain identity/capacity until physical cleanup succeeds', async () => {
    let blocked = true;
    class Runtime extends FakeRuntimeAdapter {
      override async runSandbox(options: RunSandboxOptions): Promise<{ runtimeId: string }> {
        const { runtimeId } = await super.runSandbox(options);
        throw Object.assign(new ExecutionNodeError('network_isolation_violation'), { runtimeId, cleanupFailed: true });
      }
      override async destroySandbox(id: string) {
        if (blocked) throw new Error('mount still busy');
        return super.destroySandbox(id);
      }
    }
    const node = createExecutionNode({ adapter: new Runtime() });
    const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: [], source: { repo: 'r', path: 'p', commit: 'c' } };
    const box = await node.daemon.createSandbox({ commandId: 'create', spec: { tenantId: 'immo', profile: 'live', network: 'none',
      command: ['/bin/true'], devScope, quotaMiB: 16, quotaInodes: 1024, baseMounts: [] }, ownership: { tenantId: 'immo' } } as never);
    await expect(node.daemon.promoteToRunning('immo', box.id, { commandId: 'start', devScope, quotaMiB: 704, uid: 1000, gid: 1000 }))
      .rejects.toMatchObject({ code: 'network_isolation_violation' });
    expect(box.runtimeId).toBeDefined(); expect(box.state).toBe('failed');
    expect(node.audit.list().some(row => row.type === 'sandbox.network_isolation_violation')).toBe(true);
    expect(node.admission.reservedMiB('immo')).toBe(704);
    await expect(node.daemon.deleteSandbox('immo', box.id, { commandId: 'delete', devScope })).rejects.toThrow('busy');
    expect(box.runtimeId).toBeDefined(); expect(node.admission.reservedMiB('immo')).toBe(704);
    blocked = false;
    await node.daemon.deleteSandbox('immo', box.id, { commandId: 'retry', devScope });
    expect(box.state).toBe('destroyed'); expect(node.admission.reservedMiB('immo')).toBe(0);
  });
});
