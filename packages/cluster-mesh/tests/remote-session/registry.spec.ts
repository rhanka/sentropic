import { describe, expect, it } from 'vitest';
import {
  createSessionOriginRegistry,
  FORBIDDEN_LISTING_FIELDS,
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
