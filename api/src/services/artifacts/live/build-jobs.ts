import type { Handoff, HandoffReceipt } from './handoff';
import type { LiveKey } from './records';
import type { HandoffOutcomes } from './handoff-publication';

/** Above the longest build-only run (each phase bounded by withinPhase, the runtime by its lifetime) plus teardown:
 * a run older than this is presumed dead and can be re-admitted. */
export const RUN_STALE_MS = 3_900_000;
/** Builder-side job ledger of the host build API. One run token per admission; only the current run may fail it. */
export interface BuildJobRecord {
  storageScopeId: string; artifactId: string; jobId: string; state: 'accepted' | 'published' | 'failed';
  token: string; admittedAt: number; code?: string; reason?: string; handoff?: Handoff; receipt?: HandoffReceipt;
}
export interface RecordStore {
  read(id: string): Promise<BuildJobRecord | undefined>;
  /** Serialized read-modify-write of one record (row lock in Postgres). */
  update<T>(id: string, change: (current: BuildJobRecord | undefined) => { next?: BuildJobRecord; result: T }): Promise<T>;
}
export const buildJobId = (key: LiveKey, jobId: string) => JSON.stringify([key.storageScopeId, key.artifactId, jobId]);

export function createBuildJobs(store: RecordStore, now: () => number, token: () => string) {
  const owned = (key: LiveKey, record: BuildJobRecord | undefined) =>
    record && record.storageScopeId === key.storageScopeId && record.artifactId === key.artifactId ? record : undefined;
  return {
    read: async (key: LiveKey, jobId: string) => owned(key, await store.read(buildJobId(key, jobId))),
    /** `run` is true only for a new run: first admission, after a failure, or after a stale run. */
    admit: (key: LiveKey, jobId: string) => store.update(buildJobId(key, jobId), current => {
      const record = owned(key, current);
      if (record && (record.state === 'published' || (record.state === 'accepted' && now() - record.admittedAt < RUN_STALE_MS))) {
        return { result: { record, run: false } };
      }
      const next: BuildJobRecord = { ...key, jobId, state: 'accepted', token: token(), admittedAt: now(),
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
