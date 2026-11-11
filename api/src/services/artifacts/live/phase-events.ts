import { logger } from '../../../logger';
import type { KvStore } from './cache-storage';

/** Persisted phase events (§7.6.1): one durable event per phase/step, stored as one KV row per invocation
 * (`artifact-builder-phase-events/v1`) plus a per-day index row listing invocation ids. Rows carry no
 * secrets (§5.6); retention (30 days) runs in the scheduler pass of §7.1.5. A phase that ends without its
 * event (sink write failure) increments the in-memory counter and logs — never a silent zero. */
export const PHASE_EVENTS_NAMESPACE = 'artifact-builder-phase-events/v1';
export type PhaseOperation = 'live_start' | 'live_write' | 'git_commit' | 'stop' | 'git_publish' | 'prewarm';
export type PhaseCase = 'warm' | 'cold-known' | 'cold-new-lockfile';
/** Closed event field set (§7.6.1). Server-derived tagging (`case`, `pool`) lands in L6; L1 records the rest. */
export interface PhaseEvent {
  invocationId: string; artifactId?: string; storageScopeId?: string;
  operation: PhaseOperation; phase: string; step?: string;
  case?: PhaseCase; lockSha256?: string; cacheKey?: string; cacheState?: string; pool?: string;
  at: number; ms: number; outcome: 'ok' | 'fail'; code?: string; reason?: string; attempt?: number;
}
/** Invocation context for `runPhase`/`runInstallStep` write-through; undefined when no sink is composed
 * (events stay log-only on older compositions). */
export function eventsContext(ports: { events?: PhaseEventSink }, invocationId: string, operation: PhaseOperation) {
  return ports.events ? { sink: ports.events, invocationId, operation } : undefined;
}
export interface PhaseEventSink {
  /** Best-effort write-through: a store failure increments `failures()`, logs, and resolves — phases never
   * fail because their measurement did. */
  record(event: PhaseEvent): Promise<void>;
  read(invocationId: string): Promise<PhaseEvent[]>;
  invocationIds(day: string): Promise<string[]>;
  /** Visible defect counter: every record that never landed. */
  failures(): number;
}
const invocationKey = (invocationId: string) => `inv:${invocationId}`;
const dayKey = (day: string) => `day:${day}`;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
/** Maximum events kept per invocation row (an invocation carries ~30 phases; the cap bounds a runaway emitter). */
export const PHASE_EVENTS_PER_INVOCATION_MAX = 128;
export function createPhaseEventSink(store: KvStore, options: {
  now?(): number; log?(fields: Record<string, unknown>): void;
} = {}): PhaseEventSink {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((fields: Record<string, unknown>) => logger.info(fields));
  let dropped = 0;
  return {
    async record(event) {
      try {
        await store.update<PhaseEvent[], void>(invocationKey(event.invocationId), current => {
          const next = [...(current ?? []), event];
          return { next: next.length > PHASE_EVENTS_PER_INVOCATION_MAX ? next.slice(-PHASE_EVENTS_PER_INVOCATION_MAX) : next,
            result: undefined };
        });
        await store.update<string[], void>(dayKey(dayOf(event.at)), current => {
          const next = current?.includes(event.invocationId) ? current : [...(current ?? []), event.invocationId];
          return { next, result: undefined };
        });
      } catch (error) {
        dropped++;
        log({ msg: 'artifact_phase_event_dropped', invocationId: event.invocationId, phase: event.phase,
          reason: error instanceof Error ? error.message : 'unknown' });
      }
    },
    async read(invocationId) {
      return (await store.read<PhaseEvent[]>(invocationKey(invocationId))) ?? [];
    },
    async invocationIds(day) {
      return (await store.read<string[]>(dayKey(day))) ?? [];
    },
    failures: () => dropped,
  };
}
/** Breach descriptors the scheduler pass turns into `artifact_slo_breach` lines (§7.6.3; wiring is L6). */
export interface PhaseBreach { invocationId: string; phase: string; kind: 'failed_phase' | 'cache_not_prewarmed'
  | 'measurement_gap'; at: number; detail?: string }
/** Pure breach evaluation over one invocation's events plus the sink defect counter. */
export function evaluateBreaches(events: readonly PhaseEvent[], sinkFailures: number): PhaseBreach[] {
  const breaches: PhaseBreach[] = events.flatMap((event): PhaseBreach[] => {
    if (event.outcome === 'fail' && event.code === 'cache_not_prewarmed') {
      return [{ invocationId: event.invocationId, phase: event.phase, kind: 'cache_not_prewarmed' as const,
        at: event.at, detail: event.lockSha256 }];
    }
    if (event.outcome === 'fail') {
      return [{ invocationId: event.invocationId, phase: event.phase, kind: 'failed_phase' as const, at: event.at,
        detail: event.code && event.reason ? `${event.code}:${event.reason}` : event.code }];
    }
    return [];
  });
  if (sinkFailures > 0) {
    const latest = events[events.length - 1];
    breaches.push({ invocationId: latest?.invocationId ?? 'unknown', phase: latest?.phase ?? 'unknown',
      kind: 'measurement_gap', at: latest?.at ?? Date.now(), detail: `phase_event_write_failures:${sinkFailures}` });
  }
  return breaches;
}
export function logBreaches(breaches: readonly PhaseBreach[],
  log: (fields: Record<string, unknown>) => void = fields => logger.info(fields)): void {
  for (const breach of breaches) log({ msg: 'artifact_slo_breach', ...breach });
}
