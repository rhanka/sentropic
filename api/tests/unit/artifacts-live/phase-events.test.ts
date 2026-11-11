import { describe, expect, it, vi } from 'vitest';
import { createPhaseEventSink, evaluateBreaches, logBreaches } from '../../../src/services/artifacts/live/phase-events';
import type { KvStore } from '../../../src/services/artifacts/live/cache-storage';
import type { PhaseEvent } from '../../../src/services/artifacts/live/phase-events';

function fakeStore(): KvStore {
  const rows = new Map<string, unknown>();
  return {
    read: async key => rows.get(key) as never,
    update: async (key, change) => {
      const { next, result } = change(rows.get(key) as never);
      if (next !== undefined) rows.set(key, next);
      return result;
    },
  };
}
const event = (over: Partial<PhaseEvent> = {}): PhaseEvent => ({ invocationId: 'inv-1', artifactId: 'art-1',
  operation: 'live_start', phase: 'install', at: 1_000, ms: 5, outcome: 'ok', ...over });

describe('phase-event sink', () => {
  it('should append one row per invocation and index invocation ids per day', async () => {
    const sink = createPhaseEventSink(fakeStore(), { now: () => 2_000 });
    await sink.record(event());
    await sink.record(event({ invocationId: 'inv-1', phase: 'prepare', outcome: 'fail', code: 'builder_unavailable' }));
    await sink.record(event({ invocationId: 'inv-2', phase: 'install' }));
    expect(await sink.read('inv-1')).toHaveLength(2);
    expect((await sink.read('inv-1')).map(e => e.phase)).toEqual(['install', 'prepare']);
    expect(await sink.read('missing')).toEqual([]);
    expect((await sink.invocationIds('1970-01-01')).sort()).toEqual(['inv-1', 'inv-2']);
    expect(await sink.invocationIds('1970-01-02')).toEqual([]);
    expect(sink.failures()).toBe(0);
  });
  it('should count a failed write, log it and never fail the phase', async () => {
    const lines: Record<string, unknown>[] = [];
    const store: KvStore = { read: async () => undefined,
      update: async () => { throw new Error('kv down'); } };
    const sink = createPhaseEventSink(store, { log: fields => lines.push(fields) });
    await expect(sink.record(event())).resolves.toBeUndefined();
    expect(sink.failures()).toBe(1);
    expect(lines).toEqual([{ msg: 'artifact_phase_event_dropped', invocationId: 'inv-1', phase: 'install',
      reason: 'kv down' }]);
  });
});

describe('slo breach evaluation', () => {
  it('should flag failed phases and cache_not_prewarmed rejections, never ok phases', async () => {
    const lines: Record<string, unknown>[] = [];
    const log = vi.fn((fields: Record<string, unknown>) => { lines.push(fields); });
    const breaches = evaluateBreaches([
      event(),
      event({ phase: 'install', outcome: 'fail', code: 'cache_not_prewarmed', reason: 'lock', lockSha256: 'a'.repeat(64) }),
      event({ invocationId: 'inv-2', phase: 'build', outcome: 'fail', code: 'builder_unavailable', reason: 'phase_timeout:build' }),
    ], 0);
    expect(breaches).toEqual([
      { invocationId: 'inv-1', phase: 'install', kind: 'cache_not_prewarmed', at: 1_000, detail: 'a'.repeat(64) },
      { invocationId: 'inv-2', phase: 'build', kind: 'failed_phase', at: 1_000,
        detail: 'builder_unavailable:phase_timeout:build' },
    ]);
    logBreaches(breaches, log);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ msg: 'artifact_slo_breach', kind: 'cache_not_prewarmed' });
    expect(logBreaches([], log)).toBeUndefined();
    expect(lines).toHaveLength(2);
  });
  it('should make a missing measurement countable instead of a silent zero', async () => {
    const lines: Record<string, unknown>[] = [];
    logBreaches(evaluateBreaches([event()], 2), fields => lines.push(fields));
    expect(lines).toEqual([{ msg: 'artifact_slo_breach', invocationId: 'inv-1', phase: 'install',
      kind: 'measurement_gap', at: 1_000, detail: 'phase_event_write_failures:2' }]);
  });
});
