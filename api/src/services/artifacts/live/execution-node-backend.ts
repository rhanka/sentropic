import type { ExecutionNodeSandboxSpec } from '../../../../../apps/sandbox-node/src/contract';
import { ExecutionNodeAdapter, nodeJson, type NodeSession } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';
import { executionNodeQueue } from './execution-node-queue';
import { revokeNodeCustody } from './execution-node-custody';
import { exportRetainedBuild, type ExportProgress } from './execution-node-lifecycle';
import { LiveError, type LiveAttempt, type LiveKey, type LiveRuntime } from './records';
import type { SupervisorSources } from './supervisor';
import type { LivePorts } from './ports';
import type { RemoteRows } from './remote-live';
import type { SandboxBackend } from './sandbox-backend';

/** S1-B1 supplies sealed-base hydration and host-registry scope resolution, plus W3 and
 * publication transfer. Callers never supply tenant/ownership directly through HTTP bodies.
 */
export interface ExecutionNodeInputs {
  provision(key: LiveKey, runtime: LiveRuntime): Promise<{ session: NodeSession; spec: ExecutionNodeSandboxSpec }>;
  cache: LivePorts['cache'];
  worker: Omit<LivePorts['worker'], 'renew' | 'quiesce' | 'build'>;
  executeBuild(runtime: LiveRuntime, attempt: LiveAttempt): Promise<void>;
  exportIntent(runtime: LiveRuntime, attempt: LiveAttempt): Promise<Parameters<typeof exportRetainedBuild>[2]>;
  exportOptions: Parameters<typeof exportRetainedBuild>[3];
  acceptExport(runtime: LiveRuntime, attempt: LiveAttempt, exported: Awaited<ReturnType<typeof exportRetainedBuild>>): Promise<{ candidateDigest: string }>;
  /** Stateless D3-A forge reads; tenant is resolved from the authenticated binding, never caller JSON. */
  tenant(key: LiveKey): 'sentropic' | 'immo';
  forge: LivePorts['forge'];
  source: SupervisorSources['source'];
}
type Stored = { session: NodeSession; key: LiveKey; nodeInstanceId: string; nodeEpoch: number;
  command?: readonly string[];
  exporting?: { attemptId: string; intent: Parameters<typeof exportRetainedBuild>[2];
    progress: ExportProgress; candidate?: { candidateDigest: string } };
  pendingSpec?: ExecutionNodeSandboxSpec; createCommandId: string; removalEpoch?: number;
  revoking?: { epoch: number; commandId: string }; closed?: true; attempted?: true };
const unavailable = (): never => { throw new ExecutionNodeRefusal('node_base_hydration_unconfigured'); };
const row = (runtime: LiveRuntime) => JSON.stringify(['execution-node', runtime.sessionId, runtime.generation, runtime.leaseEpoch]);

/** Concrete control-plane backend. Agent reservations stay authoritative across replicas;
 * persisted runtime rows and deterministic command ids reconcile lost creation responses.
 */
export function createExecutionNodeBackend(node: ExecutionNodeAdapter, rows: RemoteRows,
  inputs?: ExecutionNodeInputs): SandboxBackend & { custody(runtime: LiveRuntime): Promise<NodeSession> } {
  const queue = executionNodeQueue(); const subjects = new Map<string, NodeSession>();
  const command = (runtime: LiveRuntime, op: string) => `${runtime.sessionId}:${runtime.leaseEpoch}:${runtime.routeEpoch}:${op}`;
  async function stored(runtime: LiveRuntime) {
    let value = await rows.read<Stored>(row(runtime));
    if (!value || value.closed || value.nodeInstanceId !== node.config.nodeInstanceId || value.nodeEpoch !== node.config.nodeEpoch) {
      throw new ExecutionNodeRefusal('node_runtime_unreconciled');
    }
    if (value.pendingSpec) {
      const pendingSpec = value.pendingSpec;
      // Persist the dispatch boundary before I/O, including across crashes and replicas.
      const replay = await rows.update<Stored, boolean>(row(runtime), current => {
        if (!current) throw new ExecutionNodeRefusal('node_runtime_unreconciled');
        return { next: { ...current, attempted: true }, result: current.attempted === true };
      });
      value = { ...value, attempted: true };
      let created;
      try { created = await node.create(value.session, pendingSpec, value.createCommandId); }
      catch (error) {
        // A closed HTTP refusal has not allocated this intent. Transport/5xx outcomes stay pending.
        if (!replay && error instanceof ExecutionNodeRefusal && error.status >= 400 && error.status < 500) {
          const next: Stored = { ...value, pendingSpec: undefined, closed: true };
          await rows.update<Stored, void>(row(runtime), () => ({ next, result: undefined }));
        }
        throw error;
      }
      if (typeof created.id !== 'string') throw new ExecutionNodeRefusal('invalid_node_response');
      value = { ...value, session: { ...value.session, physicalUid: created.id }, pendingSpec: undefined };
      const next = value;
      await rows.update<Stored, void>(row(runtime), () => ({ next, result: undefined }));
    }
    if (value.revoking) {
      const intent = value.revoking; const status = await node.status(value.session, intent.epoch);
      const activeEpoch = Number((status?.ownership as Record<string, unknown> | undefined)?.custodyEpoch);
      const session = activeEpoch === intent.epoch ? { ...value.session,
        ownership: { ...value.session.ownership, custodyEpoch: intent.epoch } }
        : await revokeNodeCustody(node, value.session, intent.epoch, 'runtime_removed', intent.commandId);
      value = { ...value, session, revoking: undefined }; const next = value;
      await rows.update<Stored, void>(row(runtime), () => ({ next, result: undefined }));
    }
    subjects.set(runtime.podName, value.session); return value;
  }
  async function start(runtime: LiveRuntime) {
    const { session } = await stored(runtime); const status = await node.status(session);
    if (status?.state === 'creating') await node.mutate(session, 'start', command(runtime, 'start'), { uid: 1000, gid: 1000 });
    else if (status?.state !== 'running') throw new ExecutionNodeRefusal('node_runtime_not_running');
  }
  const backend: SandboxBackend = {
    pods: {
      async ensure(key, runtime) {
        let value = await rows.read<Stored>(row(runtime)); const adopted = !!value;
        if (!value || value.closed) {
          const prepared = await (inputs?.provision(key, runtime) ?? unavailable());
          if (prepared.session.ownership.tenantId !== inputs!.tenant(key)
            || prepared.session.ownership.principalId !== runtime.ownerId
            || prepared.session.ownership.generation !== runtime.generation
            || prepared.session.ownership.sessionId !== runtime.sessionId) throw new ExecutionNodeRefusal('invalid_node_session');
          value = { key, session: prepared.session, command: prepared.spec.command,
            pendingSpec: prepared.spec, createCommandId: command(runtime, 'create'),
            nodeInstanceId: node.config.nodeInstanceId, nodeEpoch: node.config.nodeEpoch };
          const next = value;
          await rows.update<Stored, void>(row(runtime), current => {
            if (current && !current.closed && JSON.stringify(current) !== JSON.stringify(next)) throw new ExecutionNodeRefusal('node_runtime_conflict');
            return { next, result: undefined };
          });
        }
        value = await stored(runtime);
        const status = await node.status(value.session);
        if (!status || status.state === 'destroyed') throw new ExecutionNodeRefusal('node_runtime_not_running');
        return { uid: value.session.physicalUid, adopted };
      },
      async probe(_key, runtime) {
        const status = await node.status((await stored(runtime)).session);
        return !status || status.state === 'destroyed' ? 'absent' : status.state === 'running' ? 'active' : 'terminal';
      },
      async describe() { return undefined; },
      async remove(_key, runtime) {
        const recorded = await rows.read<Stored>(row(runtime)); if (!recorded || recorded.closed) return;
        let value = await stored(runtime); let session = value.session; const status = await node.status(session);
        if (!status || status.state === 'destroyed') return;
        if (value.removalEpoch === undefined) {
          const epoch = session.ownership.custodyEpoch + 1;
          value = { ...value, removalEpoch: epoch, revoking: { epoch, commandId: `${value.createCommandId}:revoke` } };
          const next = value; await rows.update<Stored, void>(row(runtime), () => ({ next, result: undefined }));
          session = (await stored(runtime)).session;
        }
        if (status.state === 'running' || status.state === 'stopping') {
          const stopped = nodeJson(await node.mutate(session, 'stop', `${value.createCommandId}:remove-stop`, { stop: { retainOutput: false } }));
          if (stopped.allProcessesExited !== true) throw new ExecutionNodeRefusal('sandbox_not_quiesced', 409, 250);
        }
        await node.mutate(session, 'delete', `${value.createCommandId}:delete`); subjects.delete(runtime.podName);
      },
    },
    cache: { acquire: (source, runtime) => inputs?.cache.acquire(source, runtime) ?? unavailable() },
    worker: {
      async clean(runtime) {
        const value = await stored(runtime); const status = await node.status(value.session);
        let uid: string | undefined;
        if (!status || status.state !== 'creating') {
          await backend.pods.remove(value.key, runtime);
          await rows.update<Stored, void>(row(runtime), () => ({ next: { ...value, closed: true }, result: undefined }));
          uid = (await backend.pods.ensure(value.key, runtime)).uid;
        }
        const cleaned = await (inputs?.worker.clean(runtime) ?? unavailable());
        return uid ? { uid } : cleaned;
      },
      prepare: (runtime, source, cache) => inputs?.worker.prepare(runtime, source, cache) ?? unavailable(),
      restore: (runtime, draft) => inputs?.worker.restore(runtime, draft) ?? unavailable(),
      prebundle: runtime => inputs?.worker.prebundle(runtime) ?? unavailable(),
      async live(runtime) { await start(runtime); return inputs?.worker.live(runtime) ?? unavailable(); },
      async build(runtime, attempt) {
        if (!inputs) return unavailable();
        let value = await stored(runtime);
        if (!value.exporting) {
          await start(runtime); await inputs.executeBuild(runtime, attempt);
          const intent = await inputs.exportIntent(runtime, attempt);
          if (!value.command) throw new ExecutionNodeRefusal('invalid_export_intent');
          value = { ...value, exporting: { attemptId: attempt.id, intent: { ...intent, command: value.command }, progress: {} } };
          const next = value; await rows.update<Stored, void>(row(runtime), () => ({ next, result: undefined }));
        }
        const exporting = value.exporting!;
        if (exporting.attemptId !== attempt.id) throw new ExecutionNodeRefusal('invalid_export_intent');
        if (exporting.candidate) return exporting.candidate;
        try {
          const exported = await exportRetainedBuild(node, value.session, exporting.intent, inputs.exportOptions,
            exporting.progress, async progress => {
              await rows.update<Stored, void>(row(runtime), current => {
                if (!current?.exporting || current.exporting.attemptId !== attempt.id) throw new ExecutionNodeRefusal('invalid_export_intent');
                return { next: { ...current, exporting: { ...current.exporting, progress } }, result: undefined };
              });
            });
          const candidate = await inputs.acceptExport(runtime, attempt, exported);
          await rows.update<Stored, void>(row(runtime), current => ({
            next: { ...current!, exporting: { ...current!.exporting!, candidate } }, result: undefined }));
          return candidate;
        } catch { throw new LiveError('builder_unavailable', 'node_export_pending'); }
      },
      async pendingBuild(runtime) {
        const value = await rows.read<Stored>(row(runtime));
        return !!value?.exporting && !value.closed && value.exporting.attemptId === runtime.attempt?.id;
      },
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
  return Object.assign(backend, { async custody(runtime: LiveRuntime) {
    const value = await rows.read<Stored>(row(runtime));
    if (!value || value.closed || value.pendingSpec || value.revoking || value.removalEpoch !== undefined
      || value.nodeInstanceId !== node.config.nodeInstanceId || value.nodeEpoch !== node.config.nodeEpoch) {
      throw new ExecutionNodeRefusal('custody_revoked', 403);
    }
    const status = await node.status(value.session);
    if (status?.state !== 'running') throw new ExecutionNodeRefusal('custody_revoked', 403);
    return value.session;
  } });
}
