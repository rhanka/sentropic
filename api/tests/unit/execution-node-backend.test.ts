import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionNodeBackend, type ExecutionNodeInputs } from '../../src/services/artifacts/live/execution-node-backend';
import { executionNodeForge } from '../../src/services/artifacts/live/execution-node-forge';
import type { RemoteRows } from '../../src/services/artifacts/live/remote-live';
import type { LiveRuntime } from '../../src/services/artifacts/live/records';
import { fakeExecutionNode, sandboxSpec, session } from './execution-node-fake';
import { ExecutionNodeAdapter } from '../../src/services/artifacts/live/execution-node-adapter';
import { ExecutionNodeRefusal } from '../../src/services/artifacts/live/execution-node-transport';

const memoryRows = (): RemoteRows => {
  const values = new Map<string, unknown>();
  return { async read<T>(key: string) { return values.get(key) as T | undefined; },
    async update<T, R>(key: string, change: (current: T | undefined) => { next?: T; result: R }) {
      const result = change(values.get(key) as T | undefined);
      if (result.next !== undefined) values.set(key, structuredClone(result.next)); else values.delete(key); return result.result;
    } };
};
const runtime = { ownerId: 'principal', sessionId: 'session', generation: 1, leaseEpoch: 1,
  rowVersion: 1, routeEpoch: 1, podName: 'subject' } as LiveRuntime;
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
    await expect(backend.pods.remove(key, runtime)).resolves.toBeUndefined();
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
  it('should replace a quiesced sandbox before waking and return its new physical identity', async () => {
    const fake = await fakeExecutionNode(); servers.push(fake); await fake.adapter.heartbeat(); const s = session();
    const inputs = { tenant: () => 'sentropic', provision: async () => ({ session: s, spec: sandboxSpec(s) }),
      worker: { clean: async () => {}, live: async () => ({ revision: 'revision', routeEpoch: 2 }) } } as unknown as ExecutionNodeInputs;
    const backend = createExecutionNodeBackend(fake.adapter, memoryRows(), inputs);
    const before = await backend.pods.ensure(key, runtime); await backend.worker.live(runtime); await backend.worker.quiesce(runtime);
    const waking = { ...runtime, routeEpoch: 2 };
    const cleaned = await backend.worker.clean(waking);
    expect(cleaned?.uid).toBeDefined(); expect(cleaned?.uid).not.toBe(before.uid);
    await expect(backend.worker.live(waking)).resolves.toMatchObject({ revision: 'revision' });
    expect(fake.node.daemon.getSandbox('sentropic', before.uid)?.state).toBe('destroyed');
    await backend.pods.remove(key, waking);
  });
  it.each(['create', 'revoke-custody'])('should reconcile a lost %s response and finish cleanup without duplicate allocation', async lost => {
    const fake = await fakeExecutionNode(); servers.push(fake); await fake.adapter.heartbeat(); const s = session(); let dropped = false;
    const adapter = new ExecutionNodeAdapter(fake.config, async (method, path, body, headers) => {
      const response = await fake.adapter.transport(method, path, body, headers);
      if (!dropped && (lost === 'create' ? method === 'POST' && path === '/v1/sandboxes' : path.endsWith('/revoke-custody'))) {
        dropped = true; throw new ExecutionNodeRefusal('node_transport_failure');
      }
      return response;
    }, fake.now);
    const inputs = { tenant: () => 'sentropic', provision: async () => ({ session: s, spec: sandboxSpec(s) }) } as unknown as ExecutionNodeInputs;
    const backend = createExecutionNodeBackend(adapter, memoryRows(), inputs);
    if (lost === 'create') await expect(backend.pods.ensure(key, runtime)).rejects.toThrow(/node_transport_failure/);
    else { await backend.pods.ensure(key, runtime); await expect(backend.pods.remove(key, runtime)).rejects.toThrow(/node_transport_failure/); }
    await backend.pods.remove(key, runtime);
    const sandboxes = fake.node.daemon.listSandboxes('sentropic');
    expect(sandboxes).toHaveLength(1); expect(sandboxes[0]?.state).toBe('destroyed');
    expect(fake.calls.filter(call => call.path.endsWith('/revoke-custody'))).toHaveLength(1);
  });
});
