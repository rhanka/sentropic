import { describe, expect, it } from 'vitest';
import {
  createSessionOriginRegistry,
  FORBIDDEN_LISTING_FIELDS,
  type SessionRef,
} from '@sentropic/cluster-mesh';

const sessionRef: SessionRef = {
  originInstanceId: 'origin-B',
  sessionId: 'session-1',
  incarnation: 'incarnation-1',
};

function viewerRegistry() {
  const registry = createSessionOriginRegistry({
    originInstanceId: 'origin-B',
    now: () => 1_793_520_000_000,
    resolveSession: (binding) => (binding.id === 'process-1' ? { ...sessionRef } : null),
  });
  registry.registerGrant({
    grantId: 'AAAAAAAAAAAAAAAAAAAAAA',
    revision: 1,
    originInstanceId: 'origin-B',
    scope: { kind: 'named-sessions', sessions: ['session-1'] },
    fieldSet: 'coarse-v1',
    purpose: 'session.list',
    issuedAt: 1_793_520_000_000,
    expiresAt: 1_793_520_060_000,
    withdrawn: false,
    futureSessionsOptIn: false,
  });
  registry.ingestLifecycle(
    { id: 'process-1', revision: 1, digest: '0'.repeat(64) },
    {
      kind: 'started',
      sourceRef: { sourceSessionId: 'src-1', sourceGeneration: 1, streamIncarnation: 'stream-1' },
      sourceAt: 1_793_520_000_000,
      factRef: { id: 'fact-1', revision: 1, digest: '1'.repeat(64) },
    },
  );
  registry.commitSourceAck({ ...sessionRef }, 'AAAAAAAAAAAAAAAAAAAAAA', '2'.repeat(64));
  return registry;
}

describe('RC2.registry REGISTRY-LISTING api selectors (session-remote-view)', () => {
  it('should expose a coarse row with the exact allowlist and no forbidden field', () => {
    const registry = viewerRegistry();
    const published = registry.publishListing({ ...sessionRef }, { id: 'AAAAAAAAAAAAAAAAAAAAAA', revision: 1, digest: '3'.repeat(64) });
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

  it('should show no row without a grant and downgrade the row on read loss', () => {
    const registry = viewerRegistry();
    expect(registry.getListingRow({ ...sessionRef })?.visibility).toBe('listing');
    registry.grantActivatedRead({ ...sessionRef });
    expect(registry.getListingRow({ ...sessionRef })?.visibility).toBe('activated');
    registry.loseActivatedRead({ ...sessionRef });
    const row = registry.getListingRow({ ...sessionRef });
    expect(row?.visibility).toBe('listing');
    expect(Object.keys(row?.projection ?? {}).sort()).toEqual(
      ['engineKind', 'originRevision', 'providerClass', 'sessionRef', 'state'],
    );
    registry.withdrawGrant('AAAAAAAAAAAAAAAAAAAAAA');
    expect(registry.getListingRow({ ...sessionRef })).toBeNull();
  });
});
