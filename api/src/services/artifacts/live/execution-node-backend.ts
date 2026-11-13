import type { ExecutionNodeSandboxSpec } from '../../../../../apps/sandbox-node/src/contract';
import { ExecutionNodeAdapter, nodeJson, type NodeSession } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';
import { executionNodeQueue } from './execution-node-queue';
import { revokeNodeCustody } from './execution-node-custody';
import type { LiveKey, LiveRuntime } from './records';
import type { LivePorts } from './ports';
import type { RemoteRows } from './remote-live';
import type { SandboxBackend } from './sandbox-backend';

/** S1-B1 supplies sealed-base hydration and host-registry scope resolution, plus W3 and
 * publication transfer. Callers never supply tenant/ownership directly through HTTP bodies.
 */
export interface ExecutionNodeInputs {
  provision(key: LiveKey, runtime: LiveRuntime): Promise<{ session: NodeSession; spec: ExecutionNodeSandboxSpec }>;
  cache: LivePorts['cache'];
  worker: Omit<LivePorts['worker'], 'renew' | 'quiesce'>;
}
type Stored = { session: NodeSession; key: LiveKey; nodeInstanceId: string; nodeEpoch: number };
const unavailable = (): never => { throw new ExecutionNodeRefusal('node_base_hydration_unconfigured'); };
const row = (runtime: LiveRuntime) => JSON.stringify(['execution-node', runtime.sessionId, runtime.generation, runtime.leaseEpoch]);

/** Concrete control-plane backend. Agent reservations stay authoritative across replicas;
 * persisted runtime rows and deterministic command ids reconcile lost creation responses.
 */
export function createExecutionNodeBackend(node: ExecutionNodeAdapter, rows: RemoteRows,
  inputs?: ExecutionNodeInputs): SandboxBackend {
  const queue = executionNodeQueue(); const subjects = new Map<string, NodeSession>();
  const command = (runtime: LiveRuntime, op: string) => `${runtime.sessionId}:${runtime.leaseEpoch}:${op}`;
  async function stored(runtime: LiveRuntime) {
    const value = await rows.read<Stored>(row(runtime));
    if (!value || value.nodeInstanceId !== node.config.nodeInstanceId || value.nodeEpoch !== node.config.nodeEpoch) {
      throw new ExecutionNodeRefusal('node_runtime_unreconciled');
    }
    subjects.set(runtime.podName, value.session); return value;
  }
  async function start(runtime: LiveRuntime) {
    const { session } = await stored(runtime); const status = await node.status(session);
    if (status?.state === 'creating') await node.mutate(session, 'start', command(runtime, 'start'), { uid: 1000, gid: 1000 });
    else if (status?.state !== 'running') throw new ExecutionNodeRefusal('node_runtime_not_running');
  }
  return {
    pods: {
      async ensure(key, runtime) {
        let value = await rows.read<Stored>(row(runtime)); const adopted = !!value;
        if (!value) {
          const prepared = await (inputs?.provision(key, runtime) ?? unavailable());
          const created = await node.create(prepared.session, prepared.spec, command(runtime, 'create'));
          if (typeof created.id !== 'string') throw new ExecutionNodeRefusal('invalid_node_response');
          value = { key, session: { ...prepared.session, physicalUid: created.id },
            nodeInstanceId: node.config.nodeInstanceId, nodeEpoch: node.config.nodeEpoch };
          const next = value;
          await rows.update<Stored, void>(row(runtime), current => {
            if (current && JSON.stringify(current) !== JSON.stringify(next)) throw new ExecutionNodeRefusal('node_runtime_conflict');
            return { next, result: undefined };
          });
        }
        const status = await node.status((await stored(runtime)).session);
        if (!status || status.state === 'destroyed') throw new ExecutionNodeRefusal('node_runtime_not_running');
        return { uid: value.session.physicalUid, adopted };
      },
      async probe(_key, runtime) {
        const status = await node.status((await stored(runtime)).session);
        return !status || status.state === 'destroyed' ? 'absent' : status.state === 'running' ? 'active' : 'terminal';
      },
      async describe() { return undefined; },
      async remove(_key, runtime) {
        const value = await stored(runtime); let session = value.session; const status = await node.status(session);
        if (!status || status.state === 'destroyed') return;
        session = await revokeNodeCustody(node, session, session.ownership.custodyEpoch + 1, 'runtime_removed', command(runtime, 'revoke'));
        await rows.update<Stored, void>(row(runtime), () => ({ next: { ...value, session }, result: undefined }));
        if (status.state === 'running' || status.state === 'stopping') {
          const stopped = nodeJson(await node.mutate(session, 'stop', command(runtime, 'remove-stop'), { stop: { retainOutput: false } }));
          if (stopped.allProcessesExited !== true) throw new ExecutionNodeRefusal('sandbox_not_quiesced', 409, 250);
        }
        await node.mutate(session, 'delete', command(runtime, 'delete')); subjects.delete(runtime.podName);
      },
    },
    cache: { acquire: (source, runtime) => inputs?.cache.acquire(source, runtime) ?? unavailable() },
    worker: {
      clean: runtime => inputs?.worker.clean(runtime) ?? unavailable(),
      prepare: (runtime, source, cache) => inputs?.worker.prepare(runtime, source, cache) ?? unavailable(),
      restore: (runtime, draft) => inputs?.worker.restore(runtime, draft) ?? unavailable(),
      prebundle: runtime => inputs?.worker.prebundle(runtime) ?? unavailable(),
      async live(runtime) { await start(runtime); return inputs?.worker.live(runtime) ?? unavailable(); },
      async build(runtime, attempt) { await start(runtime); return inputs?.worker.build(runtime, attempt) ?? unavailable(); },
      verify: (runtime, attempt) => inputs?.worker.verify(runtime, attempt) ?? unavailable(),
      async renew(runtime) { await node.mutate((await stored(runtime)).session, 'renew', `${command(runtime, 'renew')}:${runtime.rowVersion}`); },
      async quiesce(runtime) {
        const { session } = await stored(runtime); const status = await node.status(session);
        if (!status || ['destroyed', 'stopped-output-retained', 'exported'].includes(String(status.state))) return;
        const stopped = nodeJson(await node.mutate(session, 'stop', command(runtime, 'quiesce'),
          { stop: { retainOutput: true, outputSubPath: 'ui/dist' } }));
        if (stopped.allProcessesExited !== true) throw new ExecutionNodeRefusal('sandbox_not_quiesced', 409, 250);
      },
    },
    admission: { async acquire() {}, async release() {} }, // AdmissionLedger gates actual allocation on the node.
    heavy: {
      async pod(_subject, work) { return work(); },
      async run(subject, _phase, work) {
        const session = subjects.get(subject); if (!session) throw new ExecutionNodeRefusal('node_runtime_unreconciled');
        return queue.run(session.ownership.tenantId, work);
      },
      async hold() {}, async cancel() {}, async status() { return []; },
    },
  };
}
