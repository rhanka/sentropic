import { describe, expect, it } from 'vitest';
import { computeRetentionDeadline, TEN_JULIAN_YEAR_MS } from '@sentropic/cluster-mesh';
import {
  createPolicyStore,
  type PolicyStoreGates,
} from '../../src/services/cluster-mesh/session-content-policy-store';

const POLICY = {
  format: 'h2a.session-content-policy/1',
  kind: 'policy',
  policyId: 'policy-audit-1',
  policyRevision: 1,
  bindingId: 'binding-1',
  sourceBinding: {
    appMeshId: 'mesh-a',
    sourceMeshId: 'mesh-b',
    nativeAudience: 'native-policy-audience',
    registrationId: 'registration-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    bindingId: 'binding-1',
    sourceId: 'source-1',
    sourceSessionId: 'source-session-1',
    nativeSessionId: 'native-session-1',
    sourceGeneration: 1,
    bootGeneration: 1,
    custodyEpoch: 1,
    controllerEpoch: 1,
  },
  channels: {
    'session.events': { enabled: true, retention: { kind: 'none' } },
    'terminal.live': { enabled: false },
    'terminal.cache': { enabled: true, retention: { kind: 'finite', durationMs: 3_600_000 } },
    'native.mirror': { enabled: false, retention: { kind: 'none' } },
  },
};

const gates = (overrides: Partial<PolicyStoreGates> = {}): PolicyStoreGates => ({
  r15Accepted: true,
  identityAvailable: true,
  durableWriterAvailable: true,
  storageAvailable: true,
  now: () => 1_793_520_003_000,
  ...overrides,
});

const shareInput = (overrides = {}) => ({
  policy: POLICY,
  purpose: 'share' as const,
  policyRevision: 1,
  priorRevision: 0,
  priorDigest: null,
  approvedRegistrationRef: { id: 'registration-1', revision: 3 },
  ownerConsentRevision: 12,
  membershipRevision: 9,
  sourceDenialFloor: 3,
  retentionExpiresAt: 1_793_523_600_000,
  ...overrides,
});

const admit = () => {
  const store = createPolicyStore(gates());
  store.admitPolicy(shareInput());
  return store;
};

describe('STORE-ERASURE audit and purge separation', () => {
  it('should keep audit hashes and reasons while dropping payload bytes on purge', () => {
    const store = admit();
    store.initiatePurge({ policyId: 'policy-audit-1', scope: 'terminal.cache' });
    store.settlePurge({
      policyId: 'policy-audit-1',
      writerReceipt: { writerId: 'writer-1', settledAt: 1_793_520_003_000 },
    });
    const audit = store.projectAudit({ policyId: 'policy-audit-1' });
    expect(audit.policyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.purge.status).toBe('purged');
    expect(audit.purge.settledBy).toBe('writer-1');
    expect(JSON.stringify(audit)).not.toContain('terminal payload bytes');
    expect(audit.retainedPayload).toBeNull();
  });

  it('should separate backup expiry from audit retention', () => {
    const store = admit();
    const audit = store.projectAudit({ policyId: 'policy-audit-1' });
    expect(audit.backup.expiresAt).toBe(1_793_523_600_000);
    expect(audit.auditRetainUntil).toBeGreaterThan(audit.backup.expiresAt);
    store.settleBackupExpiry({ policyId: 'policy-audit-1' });
    const after = store.projectAudit({ policyId: 'policy-audit-1' });
    expect(after.backup.status).toBe('expired');
    expect(after.auditRetainUntil).toBe(audit.auditRetainUntil);
  });

  it('should record pending purge in audit until the writer settles', () => {
    const store = admit();
    store.initiatePurge({ policyId: 'policy-audit-1', scope: 'terminal.cache' });
    expect(store.projectAudit({ policyId: 'policy-audit-1' }).purge.status).toBe('purge_pending');
    expect(() => store.readRetained({ policyId: 'policy-audit-1' }))
      .toThrowError(expect.objectContaining({ code: 'purge_pending' }));
  });

  it('should let purge initiate while the source is disconnected without source veto', () => {
    const store = admit();
    store.markSourceDisconnected('policy-audit-1');
    const pending = store.initiatePurge({ policyId: 'policy-audit-1', scope: 'terminal.cache' });
    expect(pending.status).toBe('purge_pending');
    expect(store.projectAudit({ policyId: 'policy-audit-1' }).purge.initiatedWhileDisconnected).toBe(true);
  });
});

describe('r2 annex E retention deadline (W-P3-3, vectors/r2-semantics.json retentionDeadline)', () => {
  it('should map none to no expiry and finite to firstAdmissionAt+durationMs', () => {
    expect(computeRetentionDeadline({ kind: 'none' }, 1_793_520_000_000)).toBeNull();
    expect(computeRetentionDeadline({ kind: 'finite', durationMs: 1000 }, 1_793_520_000_000))
      .toBe(1_793_520_001_000);
    expect(computeRetentionDeadline({ kind: 'finite', durationMs: TEN_JULIAN_YEAR_MS }, 1_793_520_000_000))
      .toBe(2_109_096_000_000);
  });
  it('should refuse over-cap durations and unsafe deadline sums', () => {
    expect(() => computeRetentionDeadline(
      { kind: 'finite', durationMs: TEN_JULIAN_YEAR_MS + 1 }, 1_793_520_000_000,
    )).toThrowError(expect.objectContaining({ code: 'invalid_retention' }));
    expect(() => computeRetentionDeadline(
      { kind: 'finite', durationMs: 1 }, Number.MAX_SAFE_INTEGER,
    )).toThrowError(expect.objectContaining({ code: 'invalid_retention' }));
  });
  it('should refuse admission with an over-cap channel duration', () => {
    const store = createPolicyStore(gates());
    const channels = {
      ...POLICY.channels,
      'terminal.cache': { enabled: true, retention: { kind: 'finite', durationMs: TEN_JULIAN_YEAR_MS + 1 } },
    };
    expect(() => store.admitPolicy(shareInput({ policy: { ...POLICY, channels } })))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
  it('should refuse admission with zero owner consent revision (r2 W-P2-4 fence)', () => {
    const store = createPolicyStore(gates());
    expect(() => store.admitPolicy(shareInput({ ownerConsentRevision: 0 })))
      .toThrowError(expect.objectContaining({ code: 'revision_conflict' }));
  });
  it('should refuse a non-safe-integer first-admission deadline', () => {
    const store = createPolicyStore(gates());
    expect(() => store.admitPolicy(shareInput({ retentionExpiresAt: Number.MAX_SAFE_INTEGER + 1 })))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
});
