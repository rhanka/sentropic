import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, key, memoryRows } from './artifacts-live/fixture';
import { fakeExecutionNode, sandboxSpec, session } from './execution-node-fake';
import { createExecutionNodeBackend, type ExecutionNodeInputs } from '../../src/services/artifacts/live/execution-node-backend';
import { ExecutionNodeAdapter } from '../../src/services/artifacts/live/execution-node-adapter';
import { ExecutionNodeRefusal } from '../../src/services/artifacts/live/execution-node-transport';
import { createLiveController } from '../../src/services/artifacts/live/controller';

describe('controller retained export recovery', () => {
  const servers: Awaited<ReturnType<typeof fakeExecutionNode>>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });
  it.each(['upload', 'delete'] as const)('should recover after lost %s across backend/controller recreation without rebuilding', async fault => {
    const fake = await fakeExecutionNode(); servers.push(fake); await fake.adapter.heartbeat(); const f = fixture();
    let dropped = false;
    const adapter = new ExecutionNodeAdapter(fake.config, async (method, path, body, headers) => {
      const reply = await fake.adapter.transport(method, path, body, headers);
      if (fault === 'delete' && method === 'DELETE' && !dropped) { dropped = true; throw new ExecutionNodeRefusal('node_transport_failure'); }
      return reply;
    }, fake.now);
    const rows = memoryRows(); let authorizations = 0;
    const executeBuild = vi.fn(async () => {});
    const upload = vi.fn(async () => {
      if (fault === 'upload' && !dropped) { dropped = true; return new Response(null, { status: 503 }); }
      return new Response(null, { status: 200 });
    });
    const inputs: ExecutionNodeInputs = {
      tenant: () => 'sentropic', provision: async (_key, runtime) => {
        const s = session(); s.ownership = { ...s.ownership, principalId: runtime.ownerId,
          sessionId: runtime.sessionId, generation: runtime.generation };
        return { session: s, spec: sandboxSpec(s) };
      },
      worker: f.ports.worker, cache: f.ports.cache, forge: f.ports.forge, source: async () => { throw new Error('not used'); },
      executeBuild,
      exportIntent: async (_runtime, attempt) => ({ buildId: attempt.id, command: ['/bin/true'],
        stopCommandId: 'retained-stop', exportCommandId: 'export', deleteCommandId: 'export-delete',
        destination: 'https://s3.test/object', maxBytes: 1024 * 1024 }),
      exportOptions: { validateUrl() {}, authorizeUpload: async destination => `${destination}?authorization=${++authorizations}`, upload },
      acceptExport: async () => ({ candidateDigest: 'candidate' }),
    };
    Object.assign(f.ports, createExecutionNodeBackend(adapter, rows, inputs));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'node_export_pending' });
    const pending = (await f.state())!.runtime; expect(pending.phase).toBe('BUILDING');
    expect(fake.node.daemon.getSandbox('sentropic', pending.podUid!)?.state).toBe(fault === 'upload' ? 'exported' : 'destroyed');
    // New process, same durable rows. The upload authorization from the first process is now expired.
    fake.advance(61_000); await fake.adapter.heartbeat();
    Object.assign(f.ports, createExecutionNodeBackend(adapter, rows, inputs));
    const restarted = createLiveController(f.ports); await restarted.reconcile(key);
    expect((await f.state())?.runtime.phase).toBe('DORMANT'); expect(f.published).toEqual(['A']);
    expect(executeBuild).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledTimes(fault === 'upload' ? 2 : 1);
    expect(authorizations).toBe(fault === 'upload' ? 2 : 1);
    expect(fake.calls.filter(call => call.path.endsWith('/export')).every(call =>
      !(call.body as { spec: object }).spec.hasOwnProperty('presignedPutUrl'))).toBe(true);
  });
});
