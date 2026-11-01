import { describe, expect, it } from 'vitest';
import {
  createPolicyStore,
  type PolicyStoreGates,
} from '../../../src/services/cluster-mesh/session-content-policy-store';

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
    'terminal.cache': { enabled: true, retention: { kind: 'duration', durationSeconds: 3600 } },
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

const admit = () => {
  const store = createPolicyStore(gates());
  store.admitPolicy({
    policy: POLICY,
    purpose: 'share',
    policyRevision: 1,
    priorRevision: 0,
    priorDigest: null,
    approvedRegistrationRef: { id: 'registration-1', revision: 3 },
    ownerConsentRevision: 12,
    membershipRevision: 9,
    sourceDenialFloor: 3,
    retentionExpiresAt: 1_793_523_600_000,
  });
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
      .toMatchObject({ code: 'purge_pending' });
  });

  it('should let purge initiate while the source is disconnected without source veto', () => {
    const store = admit();
    store.markSourceDisconnected('policy-audit-1');
    const pending = store.initiatePurge({ policyId: 'policy-audit-1', scope: 'terminal.cache' });
    expect(pending.status).toBe('purge_pending');
    expect(store.projectAudit({ policyId: 'policy-audit-1' }).purge.initiatedWhileDisconnected).toBe(true);
  });
});
