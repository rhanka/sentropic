import type { Handoff, HandoffReceipt } from '@sentropic/artifacts/live-host';
import { LiveError, type LiveKey } from './records';
import { unconfigured, type ForgeBinding, type ForgeBindings } from './forge-binding';
import type { HandoffOutcomes } from './handoff-publication';
import { INSTALL_CEILING_MS_DEFAULT, PHASE_DEADLINE_MS } from './deadline';

/** Bounded phases of one build-only run: the install runs under the progress watchdog ceiling, the others under
 * PHASE_DEADLINE_MS (withinPhase or its recipe timeout). */
export const BUILD_ONLY_PHASES = ['install', 'prepare', 'build', 'verify'] as const;
/** A run older than two heavy-gate waits plus two bounded build passes is presumed dead and can be re-admitted.
 * The factor two covers the one transport retry on a fresh pod: a legitimate retry doubles the bounded duration.
 * There is no pod lifetime to derive it from (A-LIVE Amendment 1). */
export const runStaleMs = (heavyWaitMs: number, installCeilingMs: number = INSTALL_CEILING_MS_DEFAULT) =>
  2 * (heavyWaitMs + installCeilingMs + (BUILD_ONLY_PHASES.length - 1) * PHASE_DEADLINE_MS);
/** Builder-side job ledger of the host build API. One run token per admission; only the current run may fail it. */
export interface BuildJobRecord {
  storageScopeId: string; artifactId: string; jobId: string; state: 'accepted' | 'published' | 'failed';
  token: string; admittedAt: number; binding?: ForgeBinding; code?: string; reason?: string; handoff?: Handoff; receipt?: HandoffReceipt;
}
export interface RecordStore {
  read(id: string): Promise<BuildJobRecord | undefined>;
  /** Serialized read-modify-write of one record (row lock in Postgres). */
  update<T>(id: string, change: (current: BuildJobRecord | undefined) => { next?: BuildJobRecord; result: T }): Promise<T>;
}
export const buildJobId = (key: LiveKey, jobId: string) => JSON.stringify([key.storageScopeId, key.artifactId, jobId]);

export function createBuildJobs(store: RecordStore, now: () => number, token: () => string, staleMs: number) {
  const owned = (key: LiveKey, record: BuildJobRecord | undefined) =>
    record && record.storageScopeId === key.storageScopeId && record.artifactId === key.artifactId ? record : undefined;
  return {
    read: async (key: LiveKey, jobId: string) => owned(key, await store.read(buildJobId(key, jobId))),
    /** `run` is true only for a new run: first admission, after a failure, or after a stale run. The validated git
     * binding is stored with the job (R1), immutable: another value for the same job is 409 `binding_conflict`. */
    admit: (key: LiveKey, jobId: string, binding: ForgeBinding) => store.update(buildJobId(key, jobId), current => {
      const record = owned(key, current);
      if (record?.binding && !sameBinding(record.binding, binding)) throw new LiveError('binding_conflict');
      if (record && (record.state === 'published' || (record.state === 'accepted' && now() - record.admittedAt < staleMs))) {
        return { result: { record, run: false } };
      }
      const next: BuildJobRecord = { ...key, jobId, state: 'accepted', token: token(), admittedAt: now(), binding: { ...binding },
        ...(record?.handoff ? { handoff: record.handoff } : {}) };
      return { next, result: { record: next, run: true } };
    }),
    fail: (key: LiveKey, jobId: string, runToken: string, code: string, reason?: string) =>
      store.update(buildJobId(key, jobId), current => {
        const record = owned(key, current);
        if (!record || record.token !== runToken || record.state !== 'accepted') return { result: undefined };
        return { next: { ...record, state: 'failed', code, ...(reason ? { reason } : {}) }, result: undefined };
      }),
    /** HandoffOutcomes: the signed handoff is durable before it is sent, so a recovery resends the same one. */
    intend: (key: LiveKey, handoff: Handoff) => store.update(buildJobId(key, handoff.claims.jobId), current => {
      const record = owned(key, current);
      return { next: record && !record.receipt ? { ...record, handoff } : record, result: undefined };
    }),
    /** HandoffOutcomes: the first verified receipt wins; a later one returns it. */
    record: (key: LiveKey, receipt: HandoffReceipt) => store.update(buildJobId(key, receipt.jobId), current => {
      const record = owned(key, current);
      if (record?.receipt) return { result: record.receipt };
      const base: BuildJobRecord = record ?? { ...key, jobId: receipt.jobId, state: 'accepted', token: '', admittedAt: now() };
      const { code: _code, reason: _reason, ...rest } = base;
      return { next: { ...rest, state: 'published', receipt }, result: receipt };
    }),
  } satisfies HandoffOutcomes & Record<string, unknown>;
}
export type BuildJobs = ReturnType<typeof createBuildJobs>;
const sameBinding = (a: ForgeBinding, b: ForgeBinding) => a.repoId === b.repoId && a.branch === b.branch && a.subPath === b.subPath;
/** `LivePorts.jobBinding` (R1): records the binding stored with the admitted job at the HostJob generation, under the
 * per-generation immutability rule; a job without one refuses `forge_unconfigured`. */
export const jobForgeBinding = (jobs: Pick<BuildJobs, 'read'>, bindings: Pick<ForgeBindings, 'admit'>) =>
  async (key: LiveKey, jobId: string, generation: number): Promise<void> => {
    const binding = (await jobs.read(key, jobId))?.binding;
    return binding ? bindings.admit(key, generation, binding) : unconfigured();
  };
