import { describe, expect, it } from 'vitest';
import {
  createPolicyStore,
  POLICY_FORMAT,
  type PolicyStoreGates,
} from '../../../src/services/cluster-mesh/session-content-policy-store';

const BINDING = {
  appMeshId: 'mesh-a', sourceMeshId: 'mesh-b', nativeAudience: 'native-policy-audience',
  registrationId: 'registration-1', tenantId: 'tenant-1', workspaceId: 'workspace-1',
  bindingId: 'binding-1', sourceId: 'source-1', sourceSessionId: 'source-session-1',
  nativeSessionId: 'native-session-1', sourceGeneration: 1, bootGeneration: 1,
  custodyEpoch: 1, controllerEpoch: 1,
};
const CHANNELS = {
  'session.events': { enabled: true, retention: { kind: 'none' } },
  'terminal.live': { enabled: true },
  'terminal.cache': { enabled: false, retention: { kind: 'none' } },
  'native.mirror': { enabled: false, retention: { kind: 'none' } },
};
const policy = (overrides = {}) => ({
  format: POLICY_FORMAT, kind: 'policy', policyId: 'policy-share-1', policyRevision: 1,
  bindingId: 'binding-1', sourceBinding: BINDING, channels: CHANNELS, ...overrides,
});
const gates = (overrides: Partial<PolicyStoreGates> = {}): PolicyStoreGates => ({
  r15Accepted: true, identityAvailable: true, durableWriterAvailable: true,
  storageAvailable: true, now: () => 1_793_520_003_000, ...overrides,
});
const share = (extra = {}) => ({
  policy: policy(), purpose: 'share' as const, policyRevision: 1, priorRevision: 0,
  priorDigest: null, approvedRegistrationRef: { id: 'registration-1', revision: 3 },
  ownerConsentRevision: 12, membershipRevision: 9, sourceDenialFloor: 3,
  retentionExpiresAt: null, ...extra,
});
const activate = (store: ReturnType<typeof createPolicyStore>, digest: string, op = 'operation-1') =>
  store.commitActivation({ policyId: 'policy-share-1', operationId: op, proposalId: 'proposal-1',
    nonceId: 'nonce-1', policyDigest: digest, targetDigest: 't'.repeat(64), denialFloor: 3 });

describe('STORE session-content policy receiver', () => {
  it('should admit share and commit activation with a separate authority revision', () => {
    const store = createPolicyStore(gates());
    const admitted = store.admitPolicy(share());
    expect(admitted.policyRevision).toBe(1);
    expect(admitted.firstAdmissionExpiresAt).toBeNull();
    const ack = activate(store, admitted.policyDigest);
    expect(ack.phase).toBe('native-consumed');
    const receipt = store.commitReceipt({ policyId: 'policy-share-1', operationId: 'operation-1',
      ackDigest: ack.ackDigest, policyDigest: admitted.policyDigest });
    expect(receipt.phase).toBe('activation-committed');
    expect(receipt.authorityRevision).not.toBe(admitted.policyRevision);
    expect(store.isCaptureEligible('policy-share-1')).toBe(true);
  });
  it('should refuse every activation while R15 is unaccepted', () => {
    const store = createPolicyStore(gates({ r15Accepted: false }));
    expect(() => store.admitPolicy(share())).toMatchObject({ code: 'r15_unaccepted' });
    expect(store.isCaptureEligible('policy-share-1')).toBe(false);
  });
  it('should refuse activation without identity or durable writer', () => {
    expect(() => createPolicyStore(gates({ identityAvailable: false })).admitPolicy(share()))
      .toMatchObject({ code: 'authority_unavailable' });
    expect(() => createPolicyStore(gates({ durableWriterAvailable: false })).admitPolicy(share()))
      .toMatchObject({ code: 'storage_unavailable' });
  });
  it('should bind amend to the exact prior digest and freeze the first deadline', () => {
    const store = createPolicyStore(gates());
    const first = store.admitPolicy(share({ retentionExpiresAt: 1_793_606_400_000 }));
    expect(first.firstAdmissionExpiresAt).toBe(1_793_606_400_000);
    const badAmend = { ...share(), purpose: 'amend' as const, policyRevision: 2,
      priorRevision: 1, priorDigest: '0'.repeat(64) };
    expect(() => store.admitPolicy(badAmend)).toMatchObject({ code: 'revision_conflict' });
    const amended = store.admitPolicy({ ...badAmend, priorDigest: first.policyDigest });
    expect(amended.firstAdmissionExpiresAt).toBe(1_793_606_400_000);
    const extended = { ...badAmend, policyRevision: 3, priorRevision: 2,
      priorDigest: amended.policyDigest, retentionExpiresAt: 1_799_999_999_999 };
    expect(() => store.admitPolicy(extended)).toMatchObject({ code: 'invalid_request' });
  });
  it('should let denial dominate and dedupe identical operations', () => {
    const store = createPolicyStore(gates());
    const admitted = store.admitPolicy(share());
    store.raiseDenial('policy-share-1', 4);
    expect(() => activate(store, admitted.policyDigest)).toMatchObject({ code: 'denial_active' });
    store.clearDenial('policy-share-1');
    const first = activate(store, admitted.policyDigest);
    expect(activate(store, admitted.policyDigest).ackDigest).toBe(first.ackDigest);
    expect(() => activate(store, admitted.policyDigest, 'operation-2'))
      .toMatchObject({ code: 'revision_conflict' });
  });
  it('should refresh capture on reconnect without extending retained expiry', () => {
    const store = createPolicyStore(gates());
    const admitted = store.admitPolicy(share({ retentionExpiresAt: 1_793_606_400_000 }));
    activate(store, admitted.policyDigest);
    const grant = store.refreshCapture({ policyId: 'policy-share-1',
      newTarget: { connectionId: 'connection-2', connectionGeneration: 2 }, stableSourceBinding: BINDING });
    expect(grant.retainedExpiresAt).toBe(1_793_606_400_000);
    expect(() => store.refreshCapture({ policyId: 'policy-share-1',
      newTarget: { connectionId: 'connection-3', connectionGeneration: 3 },
      stableSourceBinding: { ...BINDING, sourceSessionId: 'other-session' } }))
      .toMatchObject({ code: 'source_reauthorization_required' });
  });
  it('should refuse retained reads past the immutable deadline', () => {
    let now = 1_793_520_003_000;
    const store = createPolicyStore(gates({ now: () => now }));
    store.admitPolicy(share({ retentionExpiresAt: 1_793_520_004_000 }));
    expect(store.readRetained({ policyId: 'policy-share-1' }).expiresAt).toBe(1_793_520_004_000);
    now = 1_793_520_005_000;
    expect(() => store.readRetained({ policyId: 'policy-share-1' }))
      .toMatchObject({ code: 'object_expired' });
  });
  it('should keep purge pending until the admitted writer settles it', () => {
    const store = createPolicyStore(gates());
    store.admitPolicy(share());
    expect(store.initiatePurge({ policyId: 'policy-share-1', scope: 'terminal.cache' }).status)
      .toBe('purge_pending');
    expect(() => store.settlePurge({ policyId: 'policy-share-1', writerReceipt: null }))
      .toMatchObject({ code: 'purge_pending' });
    expect(store.settlePurge({ policyId: 'policy-share-1',
      writerReceipt: { writerId: 'writer-1', settledAt: 1_793_520_003_000 } }).status).toBe('purged');
  });
});
