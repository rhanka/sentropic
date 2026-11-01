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
import { createRegistryState, createSessionRow, sessionKey } from '../../src/sessions/registry-store.js';
import { ingestLifecycle } from '../../src/sessions/registry-ingest.js';

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

const ingest = (registry: ReturnType<typeof createSessionOriginRegistry>, fact: ReturnType<typeof startedFact>, processBinding = binding) =>
  registry.ingestLifecycle({ processBindingRef: processBinding, fact });
const publish = (registry: ReturnType<typeof createSessionOriginRegistry>) =>
  registry.publishListing({ sessionRef: { ...sessionRef }, grantRef });
const renew = (registry: ReturnType<typeof createSessionOriginRegistry>) =>
  registry.renewFreshness({ sessionRef: { ...sessionRef }, visibility: 'listing' });
const snap = (registry: ReturnType<typeof createSessionOriginRegistry>) =>
  registry.snapshot({ sessionRef: { ...sessionRef } });

describe('RC2.registry REGISTRY-LISTING', () => {
  it('should project exactly the coarse allowlist with no forbidden field at the export boundary', async () => {
    const { registry } = registryWithSession();
    expect((await ingest(registry, startedFact(1_793_520_000_000))).status).toBe('local-committed');
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    const published = await publish(registry);
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

  it('should refuse publishListing without an approved grant (fail-closed)', async () => {
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
      resolveSession: () => ({ ...sessionRef }),
    });
    expect(await publish(registry)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_unavailable' },
    });
  });

  it('should return remote-unknown without a committed source ACK, never remote-committed', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
    expect((await publish(registry)).status).toBe('remote-unknown');
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

  it('should refuse on expired grant and fence rows plus subscriptions on withdrawal', async () => {
    const { registry, now } = registryWithSession();
    await ingest(registry, startedFact(now.value));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    now.value += 61_000;
    expect(await publish(registry)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_expired' },
    });

    const fresh = registryWithSession();
    await ingest(fresh.registry, startedFact(1_793_520_000_000));
    const subEvents: string[] = [];
    fresh.registry.subscribe({ ...sessionRef }, (event) => { subEvents.push(event.kind); });
    fresh.registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    expect(fresh.registry.getListingRow({ ...sessionRef })).not.toBeNull();
    fresh.registry.withdrawGrant('AAAAAAAAAAAAAAAAAAAAAA');
    expect(fresh.registry.getListingRow({ ...sessionRef })).toBeNull();
    expect(subEvents).toContain('listing-withdrawn');
    expect(await publish(fresh.registry)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_revoked' },
    });
  });

  it('should downgrade to coarse listing on read loss and remove the row when listing is not current', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
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
  it('should keep disjoint record classes independent across concurrent route and lifecycle updates', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
    const before = await snap(registry);
    registry.recordRouteState({ ...sessionRef }, { routeId: 'route-1', generation: 1, state: 'open' });
    const after = await snap(registry);
    expect(before.status).toBe('remote-unknown');
    expect(after.status).toBe('remote-unknown');
    if (after.status !== 'remote-unknown' || before.status !== 'remote-unknown') return;
    expect(after.snapshot.descriptor.originRevision).toBe(before.snapshot.descriptor.originRevision);
  });

  it('should never promote a replica to origin writer during a partition', async () => {
    const { registry } = registryWithSession();
    const takeover = await ingest(
      registry,
      startedFact(1_793_520_000_000),
      { id: 'foreign-process', revision: 1, digest: 'f'.repeat(64) },
    );
    expect(takeover).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
  });

  it('should dedupe exact duplicates and quarantine same coordinates with a different hash', async () => {
    const { registry } = registryWithSession();
    const fact = startedFact(1_793_520_000_000);
    expect((await ingest(registry, fact)).status).toBe('local-committed');
    expect((await ingest(registry, fact)).status).toBe('local-committed');
    const conflict = await ingest(registry, {
      ...fact,
      factRef: { id: 'fact-1', revision: 1, digest: '9'.repeat(64) },
    });
    expect(conflict).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
    expect(registry.isQuarantined({ ...sessionRef })).toBe(true);
  });
});

describe('RC2.registry REGISTRY-STALE', () => {
  it('should emit freshness every 5000ms with no catch-up burst and no 15000ms extension', async () => {
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
    await ingest(registry, startedFact(now));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    expect(ticks).toHaveLength(1);
    const tick = ticks[0] as () => void;
    now += 5000;
    tick();
    expect((await renew(registry)).status).toBe('rate-limited');
    now += 5000;
    tick();
    expect((await renew(registry)).status).toBe('rate-limited');
    now += 12_000;
    tick();
    expect((await renew(registry)).status).toBe('rate-limited');
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });

  it('should run the scheduler with zero native ingest calls', async () => {
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
    await ingest(registry, startedFact(now));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    resolveSession.mockClear();
    now += 5000;
    (ticks[0] as () => void)();
    now += 5000;
    (ticks[0] as () => void)();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(registry.isLive({ ...sessionRef })).toBe(true);
  });

  it('should invalidate cached freshness on restart until a new verified read', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
    registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    await renew(registry);
    expect(registry.isLive({ ...sessionRef })).toBe(true);
    registry.restart();
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });
});

describe('RC2.registry REGISTRY-SPLIT-BRAIN', () => {
  it('should quarantine on divergent writers at one epoch without timestamp arbitration', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
    const split = registry.reportSplitBrain(
      { ...sessionRef },
      { writerEpoch: 1, originRevision: 1, digest: 'a'.repeat(64) },
      { writerEpoch: 1, originRevision: 1, digest: 'b'.repeat(64) },
    );
    expect(split.quarantined).toBe(true);
    expect(registry.isQuarantined({ ...sessionRef })).toBe(true);
    expect(registry.isLive({ ...sessionRef })).toBe(false);
  });

  it('should let terminal tombstone dominate stale presence forever for that incarnation', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
    await ingest(registry, {
      ...startedFact(1_793_520_000_001),
      kind: 'tombstoned',
      factRef: { id: 'fact-2', revision: 1, digest: '4'.repeat(64) },
    });
    expect(registry.getListingRow({ ...sessionRef })?.state).toBe('ended');
    expect(registry.isLive({ ...sessionRef })).toBe(false);
    const late = await ingest(registry, {
      ...startedFact(1_793_520_000_002),
      kind: 'source-reconnected',
      factRef: { id: 'fact-3', revision: 1, digest: '5'.repeat(64) },
    });
    expect(late).toMatchObject({ status: 'refused', error: { code: 'relay_origin_refused' } });
  });
});

describe('RC2.registry r2 re-pin (manifest 133e23f5)', () => {
  it('should match the r2 listing digest vector over the exact coarse domain', async () => {
    const fixtureRef: SessionRef = {
      originInstanceId: 'fixture-B',
      sessionId: 'fixture-session',
      incarnation: 'fixture-incarnation',
    };
    const registry = createSessionOriginRegistry({
      originInstanceId: 'fixture-B',
      now: () => 1_793_520_000_000,
      resolveSession: (b) => (b.id === 'process-1' ? { ...fixtureRef } : null),
    });
    registry.registerGrant({
      grantId: 'AAAAAAAAAAAAAAAAAAAAAA',
      revision: 1,
      originInstanceId: 'fixture-B',
      scope: { kind: 'named-sessions', sessions: ['fixture-session'] },
      fieldSet: 'coarse-v1',
      purpose: 'session.list',
      issuedAt: 1_793_520_000_000,
      expiresAt: 1_793_520_060_000,
      withdrawn: false,
      futureSessionsOptIn: false,
    });
    await registry.ingestLifecycle({
      processBindingRef: binding,
      fact: startedFact(1_793_520_000_000),
    });
    await registry.ingestLifecycle({
      processBindingRef: binding,
      fact: {
        ...startedFact(1_793_520_000_001),
        kind: 'waiting-input',
        factRef: { id: 'fact-2', revision: 1, digest: '2'.repeat(64) },
      },
    });
    registry.commitSourceAck({ ...fixtureRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
    const published = await registry.publishListing({
      sessionRef: { ...fixtureRef },
      grantRef,
    });
    expect(published.status).toBe('remote-committed');
    if (published.status !== 'remote-committed') return;
    expect(published.projection).toEqual({
      sessionRef: fixtureRef,
      engineKind: 'cli',
      providerClass: 'claude',
      originRevision: 2,
      state: 'running',
    });
    expect(published.projectionDigest).toBe(
      '226ad2fed8143a5c9f5549fb3ae2cbd5e42ae13af67ca6c1957bb9233233fe98',
    );
  });

  it('should sign freshness at min(issuedAt+15000, G-5000) and stop at min(expiresAt, G-5000) or age >= 15000', async () => {
    const now = { value: 1_793_520_000_000 };
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => now.value,
      resolveSession: () => ({ ...sessionRef }),
    });
    registry.registerGrant(grantRecord({ expiresAt: now.value + 10_000 }));
    await ingest(registry, startedFact(now.value));
    expect((await renew(registry)).status).toBe('remote-unknown');
    now.value += 4_999;
    expect(registry.isLive({ ...sessionRef })).toBe(true);
    now.value += 1;
    expect(registry.isLive({ ...sessionRef })).toBe(false);

    const far = { value: 1_793_520_000_000 };
    const farRegistry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => far.value,
      resolveSession: () => ({ ...sessionRef }),
    });
    farRegistry.registerGrant(grantRecord());
    await ingest(farRegistry, startedFact(far.value));
    await renew(farRegistry);
    far.value += FRESHNESS_BOUND_MS - 1;
    expect(farRegistry.isLive({ ...sessionRef })).toBe(true);
    far.value += 1;
    expect(farRegistry.isLive({ ...sessionRef })).toBe(false);
  });

  it('should refuse a nonpositive signed freshness interval and unknown clock confidence', async () => {
    const tight = { value: 1_793_520_000_000 };
    const tightRegistry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => tight.value,
      resolveSession: () => ({ ...sessionRef }),
    });
    tightRegistry.registerGrant(grantRecord({ expiresAt: tight.value + FRESHNESS_INTERVAL_MS }));
    await ingest(tightRegistry, startedFact(tight.value));
    expect(await renew(tightRegistry)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_expired' },
    });

    const brokenClock = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => Number.NaN,
      resolveSession: () => ({ ...sessionRef }),
    });
    brokenClock.registerGrant(grantRecord());
    await ingest(brokenClock, startedFact(1_793_520_000_000));
    expect(await renew(brokenClock)).toMatchObject({
      status: 'refused',
      error: { code: 'relay_unavailable' },
    });
  });

  it('should refuse originRevision allocation at integer exhaustion without mutating state', () => {
    const state = createRegistryState({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
      resolveSession: () => ({ ...sessionRef }),
    });
    const row = createSessionRow();
    row.originRevision = Number.MAX_SAFE_INTEGER;
    state.sessions.set(sessionKey(sessionRef), row);
    state.refByRow.set(row, { ...sessionRef });
    const result = ingestLifecycle(state, binding, startedFact(1_793_520_000_000));
    expect(result).toMatchObject({ status: 'refused', error: { code: 'relay_protocol_refused' } });
    expect(row.originRevision).toBe(Number.MAX_SAFE_INTEGER);
    expect(row.seenFacts.size).toBe(0);
  });

  it('should reject invalid JavaScript API use with TypeError while refusals stay typed', async () => {
    const { registry } = registryWithSession();
    await expect(registry.publishListing(null as never)).rejects.toBeInstanceOf(TypeError);
    await expect(registry.snapshot({ sessionRef: { ...sessionRef } }, { signal: 42 as never })).rejects.toBeInstanceOf(TypeError);
    await expect(registry.ingestLifecycle([binding] as never)).rejects.toBeInstanceOf(TypeError);
    expect(() => registry.emit(null as never)).toThrow(TypeError);
    const bare = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
    });
    expect(await bare.publishListing({ sessionRef: { ...sessionRef }, grantRef })).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_unavailable' },
    });
  });
});

describe('RC2.registry fail-closed source-gaps', () => {
  it('should refuse ingest when no trusted session resolution exists', async () => {
    const registry = createSessionOriginRegistry({
      originInstanceId: 'origin-B',
      now: () => 1_793_520_000_000,
    });
    expect(await ingest(registry, startedFact(1_793_520_000_000))).toMatchObject({
      status: 'refused',
      error: { code: 'relay_grant_unavailable' },
    });
  });

  it('should refuse to mint signed freshness bytes without an enrolled origin key', async () => {
    const { registry } = registryWithSession();
    await ingest(registry, startedFact(1_793_520_000_000));
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
    expect(registry.emit(observation)).toMatchObject({ status: 'enqueued' });
    for (let index = 0; index < 300; index += 1) {
      registry.emit(observation);
    }
    expect(registry.emit(observation)).toMatchObject({
      status: 'dropped',
      dropped: expect.any(Number),
    });
  });
});
