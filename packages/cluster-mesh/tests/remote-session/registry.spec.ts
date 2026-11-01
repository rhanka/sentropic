import { describe, expect, it, vi } from 'vitest';
import {
  createSessionOriginRegistry,
  FORBIDDEN_LISTING_FIELDS,
  FRESHNESS_BOUND_MS,
  FRESHNESS_INTERVAL_MS,
  LISTING_STAGE_ROUTES,
  type ListingGrantRecord,
  type SessionRef,
} from '../../src/sessions/registry.js';

const sessionRef: SessionRef = {
  originInstanceId: 'origin-B',
  sessionId: 'session-1',
  incarnation: 'incarnation-1',
};

function grantRecord(overrides: Partial<ListingGrantRecord> = {}): ListingGrantRecord {
  const now = 1_793_520_000_000;
  return {
    grantId: 'AAAAAAAAAAAAAAAAAAAAAA',
    revision: 1,
    originInstanceId: 'origin-B',
    scope: { kind: 'named-sessions', sessions: ['session-1'] },
    fieldSet: 'coarse-v1',
    purpose: 'session.list',
    issuedAt: now,
    expiresAt: now + 60_000,
    withdrawn: false,
    futureSessionsOptIn: false,
    ...overrides,
  };
}

function registryWithSession() {
  const now = { value: 1_793_520_000_000 };
  const registry = createSessionOriginRegistry({
    originInstanceId: 'origin-B',
    now: () => now.value,
    resolveSession: (binding) => (binding.id === 'process-1' ? { ...sessionRef } : null),
  });
  registry.registerGrant(grantRecord());
  return { registry, now };
}

function startedFact(sourceAt: number) {
  return {
    kind: 'started' as const,
    sourceRef: { sourceSessionId: 'src-1', sourceGeneration: 1, streamIncarnation: 'stream-1' },
    sourceAt,
    factRef: { id: 'fact-1', revision: 1, digest: '1'.repeat(64) },
  };
}

const binding = { id: 'process-1', revision: 1, digest: '0'.repeat(64) };
const grantRef = { id: 'AAAAAAAAAAAAAAAAAAAAAA', revision: 1, digest: '3'.repeat(64) };

describe('RC2.registry REGISTRY-LISTING', () => {
  it('should project exactly the coarse allowlist with no forbidden field at the export boundary', () => {
    const { registry } = registryWithSession();
    expect(registry.ingestLifecycle(binding, startedFact(1_793_520_000_000)).status).toBe('local-committed');
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    const published = registry.publishListing({ ...sessionRef }, grantRef);
    expect(published.status).toBe('remote-committed');
    if (published.status !== 'remote-committed') return;
    expect(Object.keys(published.projection).sort()).toEqual(
      ['engineKind', 'originRevision', 'providerClass', 'sessionRef', 'state'],
    );
    const serialized = JSON.stringify(published.projection);
    for (const field of FORBIDDEN_LISTING_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('should refuse publishListing without an approved grant (fail-closed)', () => {
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
      resolveSession: () => ({ ...sessionRef }),
    });
    expect(registry.publishListing({ ...sessionRef }, grantRef)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_unavailable' },
    });
  });

  it('should return remote-unknown without a committed source ACK, never remote-committed', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    expect(registry.publishListing({ ...sessionRef }, grantRef).status).toBe('remote-unknown');
  });

  it('should refuse listing-stage content and action routes while admitting the four listing routes', () => {
    expect(LISTING_STAGE_ROUTES).toHaveLength(4);
    const { registry } = registryWithSession();
    expect(registry.assertListingStageRoute('POST', 'M/listing')).toEqual({ admitted: true });
    expect(registry.assertListingStageRoute('POST', 'M/freshness')).toEqual({ admitted: true });
    expect(registry.assertListingStageRoute('POST', 'S/events').admitted).toBe(false);
    expect(registry.assertListingStageRoute('POST', 'S/actions/:actionId/claim').admitted).toBe(false);
    expect(registry.assertListingStageRoute('POST', 'S/actions/:actionId/results').admitted).toBe(false);
  });

  it('should refuse on expired grant and fence rows plus subscriptions on withdrawal', () => {
    const { registry, now } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(now.value));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    now.value += 61_000;
    expect(registry.publishListing({ ...sessionRef }, grantRef)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_expired' },
    });

    const fresh = registryWithSession();
    fresh.registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    const subEvents: string[] = [];
    fresh.registry.subscribe({ ...sessionRef }, (event) => { subEvents.push(event.kind); });
    fresh.registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    expect(fresh.registry.getListingRow({ ...sessionRef })).not.toBeNull();
    fresh.registry.withdrawGrant('AAAAAAAAAAAAAAAAAAAAAA');
    expect(fresh.registry.getListingRow({ ...sessionRef })).toBeNull();
    expect(subEvents).toContain('listing-withdrawn');
    expect(fresh.registry.publishListing({ ...sessionRef }, grantRef)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_revoked' },
    });
  });

  it('should downgrade to coarse listing on read loss and remove the row when listing is not current', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    registry.grantActivatedRead({ ...sessionRef });
    expect(registry.getListingRow({ ...sessionRef })?.visibility).toBe('activated');
    registry.loseActivatedRead({ ...sessionRef });
    expect(registry.getListingRow({ ...sessionRef })?.visibility).toBe('listing');
    registry.withdrawGrant('AAAAAAAAAAAAAAAAAAAAAA');
    expect(registry.getListingRow({ ...sessionRef })).toBeNull();
  });
});

describe('RC2.registry REGISTRY-PARTITION', () => {
  it('should keep disjoint record classes independent across concurrent route and lifecycle updates', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    const before = registry.snapshot({ ...sessionRef });
    registry.recordRouteState({ ...sessionRef }, { routeId: 'route-1', generation: 1, state: 'open' });
    const after = registry.snapshot({ ...sessionRef });
    expect(before.status).toBe('remote-unknown');
    expect(after.status).toBe('remote-unknown');
    if (after.status !== 'remote-unknown' || before.status !== 'remote-unknown') return;
    expect(after.snapshot.descriptor.originRevision).toBe(before.snapshot.descriptor.originRevision);
  });

  it('should never promote a replica to origin writer during a partition', () => {
    const { registry } = registryWithSession();
    const takeover = registry.ingestLifecycle(
      { id: 'foreign-process', revision: 1, digest: 'f'.repeat(64) },
      startedFact(1_793_520_000_000),
    );
    expect(takeover).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
  });

  it('should dedupe exact duplicates and quarantine same coordinates with a different hash', () => {
    const { registry } = registryWithSession();
    const fact = startedFact(1_793_520_000_000);
    expect(registry.ingestLifecycle(binding, fact).status).toBe('local-committed');
    expect(registry.ingestLifecycle(binding, fact).status).toBe('local-committed');
    const conflict = registry.ingestLifecycle(binding, {
      ...fact,
      factRef: { id: 'fact-1', revision: 1, digest: '9'.repeat(64) },
    });
    expect(conflict).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
    expect(registry.isQuarantined({ ...sessionRef })).toBe(true);
  });
});

describe('RC2.registry REGISTRY-STALE', () => {
  it('should emit freshness every 5000ms with no catch-up burst and no 15000ms extension', () => {
    expect(FRESHNESS_INTERVAL_MS).toBe(5000);
    expect(FRESHNESS_BOUND_MS).toBe(15000);
    let now = 1_793_520_000_000;
    const ticks: Array<() => void> = [];
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => now,
      resolveSession: () => ({ ...sessionRef }),
      schedule: (callback) => { ticks.push(callback); return () => {}; },
    });
    registry.registerGrant(grantRecord());
    registry.ingestLifecycle(binding, startedFact(now));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    expect(ticks).toHaveLength(1);
    const tick = ticks[0] as () => void;
    now += 5000;
    tick();
    expect(registry.renewFreshness({ ...sessionRef }, 'listing').status).toBe('rate-limited');
    now += 5000;
    tick();
    expect(registry.renewFreshness({ ...sessionRef }, 'listing').status).toBe('rate-limited');
    now += 12_000;
    tick();
    expect(registry.renewFreshness({ ...sessionRef }, 'listing').status).toBe('rate-limited');
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });

  it('should run the scheduler with zero native ingest calls', () => {
    let now = 1_793_520_000_000;
    const ticks: Array<() => void> = [];
    const resolveSession = vi.fn(() => ({ ...sessionRef }));
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => now,
      resolveSession,
      schedule: (callback) => { ticks.push(callback); return () => {}; },
    });
    registry.registerGrant(grantRecord());
    registry.ingestLifecycle(binding, startedFact(now));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    resolveSession.mockClear();
    now += 5000;
    (ticks[0] as () => void)();
    now += 5000;
    (ticks[0] as () => void)();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(registry.isLive({ ...sessionRef })).toBe(true);
  });

  it('should invalidate cached freshness on restart until a new verified read', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    registry.renewFreshness({ ...sessionRef }, 'listing');
    expect(registry.isLive({ ...sessionRef })).toBe(true);
    registry.restart();
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });
});

describe('RC2.registry REGISTRY-SPLIT-BRAIN', () => {
  it('should quarantine on divergent writers at one epoch without timestamp arbitration', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    const split = registry.reportSplitBrain(
      { ...sessionRef },
      { writerEpoch: 1, originRevision: 1, digest: 'a'.repeat(64) },
      { writerEpoch: 1, originRevision: 1, digest: 'b'.repeat(64) },
    );
    expect(split.quarantined).toBe(true);
    expect(registry.isQuarantined({ ...sessionRef })).toBe(true);
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });

  it('should let terminal tombstone dominate stale presence forever for that incarnation', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    registry.ingestLifecycle(binding, {
      ...startedFact(1_793_520_000_001),
      kind: 'tombstoned',
      factRef: { id: 'fact-2', revision: 1, digest: '4'.repeat(64) },
    });
    expect(registry.getListingRow({ ...sessionRef })?.state).toBe('ended');
    expect(registry.isLive({ ...sessionRef })).toBe(false);
    const late = registry.ingestLifecycle(binding, {
      ...startedFact(1_793_520_000_002),
      kind: 'source-reconnected',
      factRef: { id: 'fact-3', revision: 1, digest: '5'.repeat(64) },
    });
    expect(late).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
  });
});

describe('RC2.registry fail-closed source-gaps', () => {
  it('should refuse ingest when no trusted session resolution exists', () => {
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
    });
    expect(registry.ingestLifecycle(binding, startedFact(1_793_520_000_000))).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_unavailable' },
    });
  });

  it('should refuse to mint signed freshness bytes without an enrolled origin key', () => {
    const { registry } = registryWithSession();
    registry.ingestLifecycle(binding, startedFact(1_793_520_000_000));
    expect(() => registry.signFreshness({ ...sessionRef }, 'listing')).toThrow();
  });

  it('should emit observations through a bounded local port with drop accounting', () => {
    const { registry } = registryWithSession();
    const observation = {
      format: 'cluster-mesh.session-observation/1' as const,
      kind: 'observation' as const,
      observationId: 'AAAAAAAAAAAAAAAAAAAAAA',
      observerRef: 'observer-A',
      sessionTraceId: '1'.repeat(32),
      status: 'ok' as const,
      code: 'none',
      aggregatedBytes: 0,
      aggregatedFrames: 0,
      queueBytes: 0,
      observedAt: 1_793_520_000_000,
    };
    expect(registry.emitObservation(observation)).toMatchObject({ status: 'enqueued' });
    for (let index = 0; index < 300; index += 1) {
      registry.emitObservation(observation);
    }
    expect(registry.emitObservation(observation)).toMatchObject({
      status: 'dropped',
      dropped: expect.any(Number),
    });
  });
});
