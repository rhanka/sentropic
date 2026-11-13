import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionNodeBackend, type ExecutionNodeInputs } from '../../src/services/artifacts/live/execution-node-backend';
import { executionNodeForge } from '../../src/services/artifacts/live/execution-node-forge';
import type { RemoteRows } from '../../src/services/artifacts/live/remote-live';
import type { LiveRuntime } from '../../src/services/artifacts/live/records';
import { fakeExecutionNode, sandboxSpec, session } from './execution-node-fake';

const memoryRows = (): RemoteRows => {
  const values = new Map<string, unknown>();
  return { async read<T>(key: string) { return values.get(key) as T | undefined; },
    async update<T, R>(key: string, change: (current: T | undefined) => { next?: T; result: R }) {
      const result = change(values.get(key) as T | undefined);
      if (result.next !== undefined) values.set(key, structuredClone(result.next)); return result.result;
    } };
};
const runtime = { ownerId: 'principal', sessionId: 'session', generation: 1, leaseEpoch: 1,
  rowVersion: 1, podName: 'subject' } as LiveRuntime;
const key = { storageScopeId: 'workspace', artifactId: 'artifact' };
describe('concrete execution node backend', () => {
  const servers: Awaited<ReturnType<typeof fakeExecutionNode>>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(fake => fake.close())); });
  it('should provision, reuse the recorded physical identity, start, quiesce and remove through real node dispatch', async () => {
    const fake = await fakeExecutionNode(); servers.push(fake); await fake.adapter.heartbeat();
    const s = session(); const inputs = { tenant: () => 'sentropic', provision: vi.fn(async () => ({ session: s, spec: sandboxSpec(s) })),
      worker: { live: vi.fn(async () => ({ revision: 'revision', routeEpoch: 1 })) } } as unknown as ExecutionNodeInputs;
    const backend = createExecutionNodeBackend(fake.adapter, memoryRows(), inputs);
    const first = await backend.pods.ensure(key, runtime);
    expect(first.adopted).toBe(false); expect(await backend.pods.ensure(key, runtime)).toMatchObject({ uid: first.uid, adopted: true });
    expect(inputs.provision).toHaveBeenCalledOnce();
    await expect(backend.worker.live(runtime)).resolves.toEqual({ revision: 'revision', routeEpoch: 1 });
    expect(await backend.pods.probe(key, runtime)).toBe('active');
    await backend.worker.quiesce(runtime); await backend.pods.remove(key, runtime); await backend.pods.remove(key, runtime);
    expect(fake.node.daemon.getSandbox('sentropic', first.uid)?.state).toBe('destroyed');
    expect(fake.calls.filter(call => call.path.endsWith('/revoke-custody'))).toHaveLength(1);
  });
  it('should refuse allocation before any node request when B1 hydration is absent', async () => {
    const fake = await fakeExecutionNode(); servers.push(fake);
    const backend = createExecutionNodeBackend(fake.adapter, memoryRows());
    await expect(backend.pods.ensure(key, runtime)).rejects.toMatchObject({ code: 'node_base_hydration_unconfigured' });
    expect(fake.calls).toHaveLength(0);
  });
  it('should refuse a provisioning tenant that differs from the authenticated binding', async () => {
    const fake = await fakeExecutionNode(); servers.push(fake); const s = session('immo');
    const inputs = { tenant: () => 'sentropic', provision: async () => ({ session: s, spec: sandboxSpec(s) }) } as unknown as ExecutionNodeInputs;
    await expect(createExecutionNodeBackend(fake.adapter, memoryRows(), inputs).pods.ensure(key, runtime))
      .rejects.toMatchObject({ code: 'invalid_node_session' });
    expect(fake.calls).toHaveLength(0);
  });
  it('should route concurrent observeHead through one tenant/generation source read and refresh later', async () => {
    const head = vi.fn(async () => 'head');
    const inputs = { tenant: () => 'immo', forge: { head } } as unknown as ExecutionNodeInputs;
    const forge = executionNodeForge(inputs, async () => 1);
    await Promise.all([forge.head(key), forge.head(key)]); expect(head).toHaveBeenCalledOnce();
    await forge.head(key); expect(head).toHaveBeenCalledTimes(2);
  });
});
