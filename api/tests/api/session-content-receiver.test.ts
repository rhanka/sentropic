import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import { computeRetentionDeadline } from '@sentropic/cluster-mesh';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sessionContentPolicyAdmissions } from '../../src/db/control-schema';
import {
  createPolicyStore,
  POLICY_FORMAT,
  type PolicyStoreGates,
} from '../../src/services/cluster-mesh/session-content-policy-store';
import {
  BOOTSTRAP_STAGE_ROUTE_IDS,
  CONTENT_MOUNT,
  CONTRACT_MANIFEST_JSON_SHA256,
  CONTRACT_MANIFEST_SHA256,
  INNER_MOUNT,
  LISTING_STAGE_ROUTE_IDS,
  RECEIVER_ROUTE_TABLE,
  RELAY_MOUNT,
  RELAY_WSS_SUBPROTOCOL,
  REMOTE_MOUNT,
  ReceiverRefusal,
  createProductSessionContentReceiver,
  createSessionContentReceiver,
  routeById,
  type BoundContext,
  type EventAckStore,
  type PreparedTunnel,
} from '../../src/routes/session-content/receiver';
import {
  FAKE_A_AUDIENCE,
  FAKE_A_BROWSER_SESSION,
  FAKE_A_INSTANCE_ID,
  FAKE_SOURCE_CREDENTIAL,
  FAKE_SOURCE_HEADER,
  createFakeAEventAckStore,
  createFakeASessionContentReceiver,
  createFakeATunnelRegistry,
  fakeAPrincipal,
} from '../../src/routes/session-content/fake-a';

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
    nonceId: 'nonce-1', policyDigest: digest, targetDigest: 'a'.repeat(64), denialFloor: 3 });

describe('STORE session-content policy receiver', () => {
  it('should preserve the migration policy revision uniqueness constraint in Drizzle', () => {
    const { uniqueConstraints } = getTableConfig(sessionContentPolicyAdmissions);
    expect(uniqueConstraints.map((constraint) => ({
      name: constraint.name,
      columns: constraint.columns.map((column) => column.name),
    }))).toContainEqual({
      name: 'session_content_policy_admissions_policy_id_policy_revision_key',
      columns: ['policy_id', 'policy_revision'],
    });
  });
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
    expect(() => store.admitPolicy(share())).toThrowError(expect.objectContaining({ code: 'r15_unaccepted' }));
    expect(store.isCaptureEligible('policy-share-1')).toBe(false);
  });
  it('should refuse admission with unsigned channel retention', () => {
    const store = createPolicyStore(gates());
    const channels = { ...CHANNELS, 'terminal.cache': undefined } as typeof CHANNELS;
    expect(() => store.admitPolicy(share({ policy: policy({ channels }) })))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
  it('should refuse admission when the policy has no channels key', () => {
    const store = createPolicyStore(gates());
    const noChannels: Record<string, unknown> = policy();
    delete noChannels.channels;
    expect(() => store.admitPolicy(share({ policy: noChannels })))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
    expect(store.isCaptureEligible('policy-share-1')).toBe(false);
    expect(store.admitPolicy(share()).policyRevision).toBe(1);
  });
  it.each([{ channels: null }, { channels: 'session.events' }, { channels: [] }])(
    'should refuse malformed channels $channels', ({ channels }) => {
      const store = createPolicyStore(gates());
      expect(() => store.admitPolicy(share({ policy: policy({ channels }) })))
        .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
    },
  );
  it('should refuse activation without identity or durable writer', () => {
    expect(() => createPolicyStore(gates({ identityAvailable: false })).admitPolicy(share()))
      .toThrowError(expect.objectContaining({ code: 'authority_unavailable' }));
    expect(() => createPolicyStore(gates({ durableWriterAvailable: false })).admitPolicy(share()))
      .toThrowError(expect.objectContaining({ code: 'storage_unavailable' }));
  });
  it('should bind amend to the exact prior digest and freeze the first deadline', () => {
    const store = createPolicyStore(gates());
    const first = store.admitPolicy(share({ retentionExpiresAt: 1_793_606_400_000 }));
    expect(first.firstAdmissionExpiresAt).toBe(1_793_606_400_000);
    const amendBody = (rev: number) => policy({ policyRevision: rev });
    const badAmend = { ...share(), policy: amendBody(2), purpose: 'amend' as const,
      policyRevision: 2, priorRevision: 1, priorDigest: '0'.repeat(64) };
    expect(() => store.admitPolicy(badAmend)).toThrowError(expect.objectContaining({ code: 'revision_conflict' }));
    const amended = store.admitPolicy({ ...badAmend, priorDigest: first.policyDigest,
      retentionExpiresAt: 1_793_606_400_000 });
    expect(amended.firstAdmissionExpiresAt).toBe(1_793_606_400_000);
    const extended = { ...share(), policy: amendBody(3), purpose: 'amend' as const,
      policyRevision: 3, priorRevision: 2, priorDigest: amended.policyDigest,
      retentionExpiresAt: 1_799_999_999_999 };
    expect(() => store.admitPolicy(extended)).toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
  it('should let denial dominate and dedupe identical operations', () => {
    const store = createPolicyStore(gates());
    const admitted = store.admitPolicy(share());
    store.raiseDenial('policy-share-1', 4);
    expect(() => activate(store, admitted.policyDigest)).toThrowError(expect.objectContaining({ code: 'denial_active' }));
    store.clearDenial('policy-share-1');
    const first = activate(store, admitted.policyDigest);
    expect(activate(store, admitted.policyDigest).ackDigest).toBe(first.ackDigest);
    expect(() => activate(store, admitted.policyDigest, 'operation-2'))
      .toThrowError(expect.objectContaining({ code: 'revision_conflict' }));
  });
  it('should refresh capture on reconnect without extending retained expiry', () => {
    const store = createPolicyStore(gates());
    const admitted = store.admitPolicy(share({ retentionExpiresAt: 1_793_606_400_000 }));
    const ack = activate(store, admitted.policyDigest);
    store.commitReceipt({ policyId: 'policy-share-1', operationId: 'operation-1',
      ackDigest: ack.ackDigest, policyDigest: admitted.policyDigest });
    const grant = store.refreshCapture({ policyId: 'policy-share-1',
      newTarget: { connectionId: 'connection-2', connectionGeneration: 2 }, stableSourceBinding: BINDING });
    expect(grant.retainedExpiresAt).toBe(1_793_606_400_000);
    expect(() => store.refreshCapture({ policyId: 'policy-share-1',
      newTarget: { connectionId: 'connection-3', connectionGeneration: 3 },
      stableSourceBinding: { ...BINDING, sourceSessionId: 'other-session' } }))
      .toThrowError(expect.objectContaining({ code: 'source_reauthorization_required' }));
  });
  it('should refuse retained reads past the immutable deadline', () => {
    let now = 1_793_520_003_000;
    const store = createPolicyStore(gates({ now: () => now }));
    store.admitPolicy(share({ retentionExpiresAt: 1_793_520_004_000 }));
    expect(store.readRetained({ policyId: 'policy-share-1' }).expiresAt).toBe(1_793_520_004_000);
    now = 1_793_520_005_000;
    expect(() => store.readRetained({ policyId: 'policy-share-1' }))
      .toThrowError(expect.objectContaining({ code: 'object_expired' }));
  });
  it('should admit a finite retained deadline (r2 annex E) and never extend it on refresh', () => {
    const now = 1_793_520_003_000;
    const store = createPolicyStore(gates({ now: () => now }));
    const deadline = computeRetentionDeadline({ kind: 'finite', durationMs: 86_400_000 }, now);
    const channels = {
      ...CHANNELS,
      'terminal.cache': { enabled: true, retention: { kind: 'finite', durationMs: 86_400_000 } },
    };
    const admitted = store.admitPolicy(share({ policy: policy({ channels }), retentionExpiresAt: deadline }));
    expect(admitted.firstAdmissionExpiresAt).toBe(deadline);
    const ack = activate(store, admitted.policyDigest);
    store.commitReceipt({ policyId: 'policy-share-1', operationId: 'operation-1',
      ackDigest: ack.ackDigest, policyDigest: admitted.policyDigest });
    const grant = store.refreshCapture({ policyId: 'policy-share-1',
      newTarget: { connectionId: 'connection-2', connectionGeneration: 2 }, stableSourceBinding: BINDING });
    expect(grant.retainedExpiresAt).toBe(deadline);
    expect(store.readRetained({ policyId: 'policy-share-1' }).expiresAt).toBe(deadline);
  });
  it('should refuse a non-safe-integer deadline and a zero consent revision (r2 fences)', () => {
    const store = createPolicyStore(gates());
    expect(() => store.admitPolicy(share({ retentionExpiresAt: Number.MAX_SAFE_INTEGER + 1 })))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
    expect(() => store.admitPolicy(share({ ownerConsentRevision: 0 })))
      .toThrowError(expect.objectContaining({ code: 'revision_conflict' }));
  });
  it('should keep purge pending until the admitted writer settles it', () => {
    const store = createPolicyStore(gates());
    store.admitPolicy(share());
    expect(store.initiatePurge({ policyId: 'policy-share-1', scope: 'terminal.cache' }).status)
      .toBe('purge_pending');
    expect(() => store.settlePurge({ policyId: 'policy-share-1', writerReceipt: null }))
      .toThrowError(expect.objectContaining({ code: 'purge_pending' }));
    expect(store.settlePurge({ policyId: 'policy-share-1',
      writerReceipt: { writerId: 'writer-1', settledAt: 1_793_520_003_000 } }).status).toBe('purged');
  });
  it('should report the true purge state on retained reads (pending vs settled)', () => {
    const store = createPolicyStore(gates());
    store.admitPolicy(share());
    store.initiatePurge({ policyId: 'policy-share-1', scope: 'terminal.cache' });
    expect(() => store.readRetained({ policyId: 'policy-share-1' }))
      .toThrowError(expect.objectContaining({ code: 'purge_pending' }));
    store.settlePurge({ policyId: 'policy-share-1',
      writerReceipt: { writerId: 'writer-1', settledAt: 1_793_520_003_000 } });
    expect(() => store.readRetained({ policyId: 'policy-share-1' }))
      .toThrowError(expect.objectContaining({ code: 'purged' }));
  });
});

// ---------------------------------------------------------------------------
// RC2.receiver — RECEIVER / CHAIN-MOUNT / CHAIN-LANE (plan v1.6 r2, lot row 646)
// ---------------------------------------------------------------------------

const NOW = 1_793_520_000_000;
const boundCtx = (overrides: Partial<BoundContext> = {}): BoundContext => ({
  sessionRef: { originInstanceId: 'mesh-b', sessionId: 'source-session-1', incarnation: 'inc-1' },
  stage: 'bound',
  engineKind: 'cli',
  lane: 'lifecycle',
  circuitId: 'circuit-1',
  descriptorDigest: 'd'.repeat(64),
  targetDigest: 'a'.repeat(64),
  visibility: 'activated',
  sourceAck: true,
  ...overrides,
});
const SOURCE_HEADERS = { [FAKE_SOURCE_HEADER]: FAKE_SOURCE_CREDENTIAL } as const;
const recordingHandler = (id: string, calls: string[]) => async (c: Context) => {
  calls.push(id);
  return c.json({ ok: true, routeId: id });
};
const tunnelFixture = (overrides: Partial<PreparedTunnel> = {}): PreparedTunnel => ({
  tunnelId: 'tun-1',
  routeId: 'route-1',
  descriptorDigest: 'd'.repeat(64),
  circuitId: 'circuit-1',
  lane: 'lifecycle',
  linkGeneration: 1,
  adjacency: { fromInstanceId: 'mesh-b', toInstanceId: FAKE_A_INSTANCE_ID },
  audience: FAKE_A_AUDIENCE,
  issuedAt: NOW,
  expiresAt: NOW + 30_000,
  consumed: false,
  ...overrides,
});
const UPGRADE_HEADERS = {
  upgrade: 'websocket',
  connection: 'Upgrade',
  'sec-websocket-protocol': RELAY_WSS_SUBPROTOCOL,
  'x-fake-a-installation': FAKE_A_INSTANCE_ID,
} as const;
const INSTALL_HEADERS = { 'x-fake-a-installation': FAKE_A_INSTANCE_ID } as const;

/**
 * R-9 per-route vector receipt: the exact vectors/route-*.json sha256 of the sealed
 * RC2.contract r3 manifest (MANIFEST.sha256 6245d3ae…, JSON 88823475…), one per route.
 */
const R3_ROUTE_VECTOR_SHA256: Record<string, string> = {
    'source-open': '26bda742c134fc2d072e97e915f34da95d627d5b312c71161e58a4cbba64e4cd',
    'source-renew': '9aeecf90f6e323f1ffc7819ec6c3bd30d4f230a485eb1b3ca2b03c9e5a62f410',
    'grant-fetch': '8c90567874b669520d26342acdfbf4aff344c691b793a105109d45c2155fc284',
    'policy-fetch': 'ed2c60094373b82e876a4e4c3b19a255f514aefe50f5792f6e619737b141e43b',
    'activation-ack': '108aabaadfed51c40ba89680c21ae92dc91eb3840a987c810d046022ea0f1519',
    'native-challenge': 'e051cb152da481009ae45dc33ee9ea0eb7b752b64f4b465dbde0a768dfb94ba4',
    'source-control': '2e94ac5e0d6351fa635506ad0f4387cbfffcd22925f0ab75af3d6af4602ac999',
    'cli-proof': '7ad92a453d6c0d889bab419e4865a5893a9c18ba3390f5f6a2071866cb471742',
    'action-nonce': '9e3823d0ab962d3cba8924b19f08d4a05de205f1c24456be3b45301d8da15fdb',
    'continuity-ack': 'a0cbb76a6b9f930119e9a5550f38ae37e6dd94ead12f36409feb39c3100cd41a',
    'history-auth': 'ecd8d776d18f8cde487986d4797f68a7b8d3aac01eef8c456bfdfca2e90430c5',
    'history-admission': '30a6fb6ea54aa8fe7157a764229393694419f062a919e79973f1301999453d27',
    'typed-events': 'f432c01de4adc5f1769b623ebf35cbf0190e26db14f7882a57b19be5f16953d0',
    'pty-fragments': 'cea3d94e4ec06a7130a95f6987b6ca3dd9190cdb00c6f2c4bb6468c06d3b930f',
    'archive-snapshot': '2c4d21af07539ae0f2bd6ab1915b628584af65cd1a491d477f037a742aa27450',
    'archive-segment': '9535f53d46f6bd3b4ef5e0edc78ad0d6418f0351b33596c2cbc42b09f0228c0d',
    'action-stream': '1d9c3a48f0a19c0858ce5cf82ea181d27e8945bd07665ca35a2cae0947a644e4',
    'action-claim': '8735fae8ff6d153d0b0fcdf0462346cbe3c90776e1440efbb4814aa871d8c4b6',
    'action-result': '20e3a453f6427cf71abee300dd99b9b6548938f68d8647668cac19bc473ea332',
    'listing-grant-fetch': '0046d35b1bc8698203741279922653efff01f5a2cb334ce2c18c0d664f9605c2',
    'listing-grant-ack': '147690f35239c66d3a880d23996409690d52ee5edab09565e28a7748f1735b6b',
    'listing-publish': '98ac691268eb226e98ab7d4051be9b4e41cfd03341a54d02071390f5873870b1',
    'freshness-publish': '94b12eec8b215c25ede6655fb8ed72d2f599e0ffd1978ef5c6a23fc400c4782f',
    'lifecycle-publish': '078cc15260f9fa8291491f99178627e94ca93edf8320a252a55ec24db8a55cdf',
    'snapshot-publish': '99d7d7c91280e4d9db21cc05a48f31baf4f85222061d43c398f30b775871ff9d',
    'drive-binding-fetch': '1785998e25a3a93eb9f2e2935b0756c86206974d14be939cb948f617875a8069',
    'drive-binding-ack': '2284c04fa886ed0fc135aa0be62675bce8d3ab728847a8b0339018366578fdc3',
    'chat-events': 'e371e1595928fa5e6dca8d28d0270bfb18b056b3d0a06914c2cd78995e4667be',
    'relay-prepare': '578ef46081dee293f53c44a63145a1f7c72434e0c870abf3fca796c1a4baa47a',
    'relay-upgrade': '5ef144bce3c87cef8e6e9973de26770d1fe78e76cbb7cbb18cdbd965517357ce',
    'browser-listing-create': 'e41a33356038d4367d5e9bbf7b630195bca7109e9609ee7a214ab86a9efdfbbc',
    'browser-listing-delete': 'f61ebb633ebd3a061a03b4d9d516fe03cb2ad83e3c41e081bba52d214b116bc5',
    'browser-list': '9a100babfa87ccc9f758787dd90bff2400cdba40b71c9d2daeeda3e3a2e473df',
    'browser-detail': '6a4a023c622cae0c01b9679760d1428845d8b9e289402e45988624e7f2e1747e',
    'browser-events': '5478790a519af38634e1a3c9cf17007f7b0f9f2bc3d9f212cf2544b918007144',
    'policy-intent': 'e0905739382f0f38222f2453db28a31f1c7784c6d312b153a092aad924a1e031',
    'policy-confirm': '8b833543ccb95ded8e22aaf8c5a3c90a80f3c78b5d36fdfb43b5a722bc3e3161',
    'policy-idp': '90d706ccc2be27d04d47999816442ee0adc2ed1cba249d401b11693eb4a6783b',
};

/** The 14 bodyless / query-only routes of contract r3 N2 (zero entity bytes; any entity refuses). */
const BODYLESS_ROUTE_IDS = [
  'grant-fetch', 'policy-fetch', 'source-control', 'history-auth', 'history-admission',
  'action-stream', 'listing-grant-fetch', 'drive-binding-fetch', 'relay-upgrade',
  'browser-listing-delete', 'browser-list', 'browser-detail', 'browser-events', 'policy-confirm',
] as const;

describe('RECEIVER frozen dispatch table and before-body rejection', () => {
  it('should publish the 38-route table with a per-route vector receipt under the r3 manifest pins', () => {
    expect(CONTRACT_MANIFEST_SHA256).toBe('6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715');
    expect(CONTRACT_MANIFEST_JSON_SHA256).toBe('88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565');
    expect(RECEIVER_ROUTE_TABLE).toHaveLength(38);
    for (const route of RECEIVER_ROUTE_TABLE) {
      expect(route.vectorSha256).toBe(R3_ROUTE_VECTOR_SHA256[route.id]); // R-9 vector receipt per route
      expect(route.id).toBeTruthy();
    }
    expect(Object.keys(R3_ROUTE_VECTOR_SHA256)).toHaveLength(38);
    // r3 N2: policy-confirm is bodyless; exactly the 14 bodyless/query routes carry maxRequestBytes 0.
    expect(routeById('policy-confirm')?.maxRequestBytes).toBe(0);
    expect(RECEIVER_ROUTE_TABLE.filter((r) => r.maxRequestBytes === 0).map((r) => r.id).sort())
      .toEqual([...BODYLESS_ROUTE_IDS].sort());
    expect(RECEIVER_ROUTE_TABLE.filter((r) => r.lane === 'outer').map((r) => r.id).sort())
      .toEqual(['relay-prepare', 'relay-upgrade']);
    expect(LISTING_STAGE_ROUTE_IDS).toHaveLength(4);
    expect(BOOTSTRAP_STAGE_ROUTE_IDS).toContain('source-open');
    expect([CONTENT_MOUNT, INNER_MOUNT, RELAY_MOUNT, REMOTE_MOUNT]).toEqual([
      '/api/v1/auth/session/content',
      '/mesh/v1/remote-sessions',
      '/mesh/v1/session-relay',
      '/api/v1/auth/session/remote',
    ]);
  });

  it('should refuse an unbound inner request before body and handler', async () => {
    const calls: string[] = [];
    const fake = createFakeASessionContentReceiver({
      bound: null,
      handlers: { 'source-open': recordingHandler('source-open', calls) },
    });
    const res = await fake.app.request(`${CONTENT_MOUNT}/binding-1/source/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SOURCE_HEADERS },
      body: JSON.stringify({ version: 'x' }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('relay_auth_required');
    expect(calls).toEqual([]);
  });

  it('should reject missing, wrong, pseudo or unpinned source credentials (key rejection)', async () => {
    const calls: string[] = [];
    const fake = createFakeASessionContentReceiver({
      bound: boundCtx({ lane: 'content' }),
      handlers: { 'typed-events': recordingHandler('typed-events', calls) },
    });
    const path = `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/events`;
    const post = (headers: Record<string, string>) => fake.app.request(path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ events: [] }),
    });
    const missing = await post({});
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('relay_auth_required');
    const wrong = await post({ [FAKE_SOURCE_HEADER]: 'wrong' });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe('relay_auth_required');
    // Negative vector: a pseudo source header is never accepted, only the exact pinned name is.
    const pseudo = await post({ 'x-source-credential': FAKE_SOURCE_CREDENTIAL });
    expect(pseudo.status).toBe(401);
    expect((await pseudo.json()).code).toBe('relay_auth_required');
    // R-8: until the capsule pin lands, the source-auth header list is empty → fail-closed grant gap.
    const unpinned = createSessionContentReceiver({ ...fake.ports, sourceAuthHeaders: null });
    const gap = await unpinned.app.request(path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect(gap.status).toBe(503);
    expect((await gap.json()).code).toBe('relay_grant_unavailable');
    expect(calls).toEqual([]);
  });

  it('should reject wrong owner, unknown binding and foreign session scope before body', async () => {
    const path = (binding: string, session: string) =>
      `${CONTENT_MOUNT}/${binding}/source/sessions/${session}/renew`;
    const post = (p: string, bindingOwner?: string) => {
      const fake = createFakeASessionContentReceiver({
        binding: async (id) => (id === 'binding-1' ? {
          bindingId: 'binding-1', ownerId: bindingOwner ?? fakeAPrincipal.ownerId, tenantId: 'tenant-1',
          workspaceId: 'workspace-1', sourceSessionId: 'source-session-1', targetDigest: 'a'.repeat(64),
        } : null),
      });
      return fake.app.request(p, {
        method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
      });
    };
    const wrongOwner = await post(path('binding-1', 'source-session-1'), 'other-owner');
    expect(wrongOwner.status).toBe(403);
    expect((await wrongOwner.json()).code).toBe('relay_scope_refused');
    const unknownBinding = await post(path('binding-x', 'source-session-1'));
    expect((await unknownBinding.json()).code).toBe('relay_scope_refused');
    const foreignSession = await post(path('binding-1', 'other-session'));
    expect((await foreignSession.json()).code).toBe('relay_scope_refused');
  });

  it('should refuse oversize and bodyless violations before reading the body, and admit a guarded request', async () => {
    const calls: string[] = [];
    const fake = createFakeASessionContentReceiver({
      bound: boundCtx({ lane: 'content' }),
      handlers: { 'typed-events': recordingHandler('typed-events', calls) },
    });
    const path = `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/events`;
    const oversize = await fake.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999', ...SOURCE_HEADERS },
      body: '{}',
    });
    expect(oversize.status).toBe(413);
    expect((await oversize.json()).code).toBe('relay_oversize');
    // source-control is a lifecycle-lane route: bind a lifecycle carrier so the refusal
    // comes from the bodyless media check, not the lane guard.
    const lifecycleFake = createFakeASessionContentReceiver({ bound: boundCtx({ lane: 'lifecycle' }) });
    const bodyless = await lifecycleFake.app.request(`${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/control`, {
      method: 'GET',
      headers: { 'content-length': '10', ...SOURCE_HEADERS },
    });
    expect(bodyless.status).toBe(400);
    expect((await bodyless.json()).code).toBe('relay_protocol_refused');
    const ok = await fake.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SOURCE_HEADERS },
      body: JSON.stringify({ events: [{ id: 'e1' }] }),
    });
    expect(ok.status).toBe(200);
    expect(calls).toEqual(['typed-events']);
  });

  // r3 N2: the 14 bodyless/query routes carry "zero entity bytes; any entity refuses",
  // mapped per annex D: invalid_request (RC0/policy), view_refused (browser), relay_protocol_refused (mesh).
  it('should refuse any entity bytes on all 14 bodyless/query routes before the handler (r3 N2)', async () => {
    const pathOf = (id: string): string => ({
      'grant-fetch': `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/grants/proposal-1`,
      'policy-fetch': `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/policies/policy-1/1`,
      'source-control': `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/control`,
      'history-auth': `${CONTENT_MOUNT}/binding-1/history/authorizations/auth-1`,
      'history-admission': `${CONTENT_MOUNT}/binding-1/history/admissions/${'b'.repeat(64)}`,
      'action-stream': `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/actions/stream`,
      'listing-grant-fetch': `${INNER_MOUNT}/source-session-1/listing-grants/grant-1`,
      'drive-binding-fetch': `${INNER_MOUNT}/source-session-1/drive-bindings/binding-1/1`,
      'relay-upgrade': `${RELAY_MOUNT}/tunnels/tun-1`,
      'browser-listing-delete': `${REMOTE_MOUNT}/listing-grants/grant-1`,
      'browser-list': `${REMOTE_MOUNT}/sessions`,
      'browser-detail': `${REMOTE_MOUNT}/sessions/source-session-1`,
      'browser-events': `${REMOTE_MOUNT}/sessions/source-session-1/events`,
      'policy-confirm': `${CONTENT_MOUNT}/binding-1/policy-proposals/proposal-1/confirm`,
    })[id]!;
    const expectedOf = (family: string): { status: number; code: string } =>
      family === 'rc0-http' ? { status: 400, code: 'invalid_request' }
        : family === 'view' ? { status: 403, code: 'view_refused' }
        : { status: 400, code: 'relay_protocol_refused' };

    for (const id of BODYLESS_ROUTE_IDS) {
      const route = routeById(id)!;
      const calls: string[] = [];
      const fake = createFakeASessionContentReceiver({
        bound: boundCtx({ lane: route.lane }),
        browserSession: route.lane === 'browser' ? FAKE_A_BROWSER_SESSION : null,
        tunnels: createFakeATunnelRegistry([tunnelFixture()]),
        handlers: { [id]: recordingHandler(id, calls) },
      });
      const headers: Record<string, string> = route.lane === 'outer'
        ? { ...UPGRADE_HEADERS }
        : route.lane === 'browser'
          ? {}
          : { ...SOURCE_HEADERS };
      // Declared entity of 2 bytes on a bodyless route. GET/DELETE cannot carry a fetch body,
      // so the declared content-length is the entity signal; POST (policy-confirm) also sends bytes.
      const init: RequestInit = { method: route.method, headers: { 'content-length': '2', ...headers } };
      if (route.method === 'POST') init.body = '{}';
      const res = await fake.app.request(pathOf(id), init);
      const expected = expectedOf(route.refusal);
      const json = await res.json() as Record<string, unknown>;
      expect(res.status, id).toBe(expected.status);
      // relay/view bodies carry `code`; the frozen RC0 HTTP union carries `error`.
      expect((json.code ?? json.error) as string, id).toBe(expected.code);
      expect(calls, id).toEqual([]); // refused before the inner handler and body handling
    }

    // Positive branch: the same bodyless routes admit a request with zero entity bytes.
    const calls: string[] = [];
    const fake = createFakeASessionContentReceiver({
      browserSession: FAKE_A_BROWSER_SESSION,
      handlers: {
        'policy-confirm': recordingHandler('policy-confirm', calls),
        'browser-list': recordingHandler('browser-list', calls),
      },
    });
    const confirm = await fake.app.request(pathOf('policy-confirm'), { method: 'POST' });
    expect(confirm.status).toBe(200);
    const list = await fake.app.request(pathOf('browser-list'), { method: 'GET' });
    expect(list.status).toBe(200);
    expect(calls).toEqual(['policy-confirm', 'browser-list']);
  });
});

describe('RECEIVER atomic ACK and gaps (R-4/R-5)', () => {
  const ackPath = `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/acks`;
  const dedupeStore = () => {
    const seen = new Map<string, { readonly requestDigest: string; readonly ackDigest: string }>();
    const store: EventAckStore & { readonly seen: Map<string, { requestDigest: string; ackDigest: string }> } = {
      seen,
      commitActivation: ({ operationId, requestDigest }) => {
        const prior = seen.get(operationId);
        if (prior !== undefined) {
          if (prior.requestDigest !== requestDigest) throw new ReceiverRefusal('relay', 'relay_route_conflict');
          return { ackDigest: prior.ackDigest, authorityRevision: 2, gaps: ['gap-after-7'] };
        }
        const ackDigest = `ack-${requestDigest.slice(0, 12)}`;
        seen.set(operationId, { requestDigest, ackDigest });
        return { ackDigest, authorityRevision: 2, gaps: ['gap-after-7'] };
      },
      commitEvents: () => { throw new ReceiverRefusal('relay', 'relay_unavailable', true); },
      commitProjection: () => { throw new ReceiverRefusal('relay', 'relay_unavailable', true); },
      commitChat: () => { throw new ReceiverRefusal('relay', 'relay_unavailable', true); },
    };
    return store;
  };

  it('should ACK only after the matching commit, with gaps and a separate authority revision', async () => {
    const store = dedupeStore();
    const fake = createFakeASessionContentReceiver({ eventAckStore: store });
    const body = JSON.stringify({ operationId: 'op-1', policyDigest: 'p'.repeat(64) });
    const res = await fake.app.request(ackPath, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body,
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ackDigest).toMatch(/^ack-/);
    expect(json.authorityRevision).toBe(2);
    expect(json.gaps).toEqual(['gap-after-7']);
    expect(json.circuitId).toBe('circuit-1');
    // R-5: identical retry returns the committed ACK; changed bytes at the same coordinates conflict.
    const replay = await fake.app.request(ackPath, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body,
    });
    expect((await replay.json()).ackDigest).toBe(json.ackDigest);
    const conflict = await fake.app.request(ackPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SOURCE_HEADERS },
      body: JSON.stringify({ operationId: 'op-1', policyDigest: 'q'.repeat(64) }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('relay_route_conflict');
  });

  it('should never emit a success-shaped ACK when the commit fails', async () => {
    const fake = createFakeASessionContentReceiver({ eventAckStore: createFakeAEventAckStore({ failCommits: true }) });
    const res = await fake.app.request(ackPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SOURCE_HEADERS },
      body: JSON.stringify({ operationId: 'op-1', policyDigest: 'p'.repeat(64) }),
    });
    expect(res.status).toBe(503);
    const json = await res.json() as Record<string, unknown>;
    expect(json.code).toBe('relay_unavailable');
    expect(json.ackDigest).toBeUndefined();
  });
});

describe('CHAIN-LANE wrong-lane and stage-subset refusal', () => {
  const claimPath = `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/actions/act-1/claim`;
  const eventsPath = `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/events`;

  it('should refuse a wrong-lane request before the inner handler and body', async () => {
    const calls: string[] = [];
    const fake = createFakeASessionContentReceiver({
      bound: boundCtx({ lane: 'content' }), // content-only grant cannot carry an action claim
      handlers: { 'action-claim': recordingHandler('action-claim', calls) },
    });
    const res = await fake.app.request(claimPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SOURCE_HEADERS },
      body: JSON.stringify({ claim: 1 }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('relay_lane_refused');
    expect(calls).toEqual([]);
    const reverse = await createFakeASessionContentReceiver({
      bound: boundCtx({ lane: 'lifecycle' }),
      handlers: { 'typed-events': recordingHandler('typed-events', calls) },
    }).app.request(eventsPath, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await reverse.json()).code).toBe('relay_lane_refused');
    expect(calls).toEqual([]);
  });

  it('should enforce the listing and bootstrap stage subsets before the handler', async () => {
    const calls: string[] = [];
    const handlers = {
      'typed-events': recordingHandler('typed-events', calls),
      'listing-publish': recordingHandler('listing-publish', calls),
      'lifecycle-publish': recordingHandler('lifecycle-publish', calls),
      'source-renew': recordingHandler('source-renew', calls),
      'source-open': recordingHandler('source-open', calls),
    };
    const listing = createFakeASessionContentReceiver({
      bound: boundCtx({ stage: 'listing', visibility: 'listing', sourceAck: true }),
      handlers,
    });
    const denied = await listing.app.request(eventsPath, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await denied.json()).code).toBe('relay_scope_refused');
    const lifecycleDenied = await listing.app.request(`${INNER_MOUNT}/source-session-1/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await lifecycleDenied.json()).code).toBe('relay_scope_refused');
    const allowed = await listing.app.request(`${INNER_MOUNT}/source-session-1/listing`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect(allowed.status).toBe(200);
    const bootstrap = createFakeASessionContentReceiver({
      bound: boundCtx({ stage: 'bootstrap', engineKind: 'cli' }),
      handlers,
    });
    const renewDenied = await bootstrap.app.request(
      `${CONTENT_MOUNT}/binding-1/source/sessions/source-session-1/renew`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
      });
    expect((await renewDenied.json()).code).toBe('relay_scope_refused');
    const appChat = createFakeASessionContentReceiver({
      bound: boundCtx({ stage: 'bootstrap', engineKind: 'app-chat' }),
      handlers,
    });
    const openDenied = await appChat.app.request(`${CONTENT_MOUNT}/binding-1/source/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await openDenied.json()).code).toBe('relay_scope_refused');
    expect(calls).toEqual(['listing-publish']);
  });

  it('should refuse a foreign inner-mount session and unlisted paths/methods', async () => {
    const fake = createFakeASessionContentReceiver({});
    const foreign = await fake.app.request(`${INNER_MOUNT}/other-session/listing`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await foreign.json()).code).toBe('relay_scope_refused');
    const extraPath = await fake.app.request(`${CONTENT_MOUNT}/binding-1/fragments/extra`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect((await extraPath.json()).code).toBe('relay_scope_refused');
    const wrongMethod = await fake.app.request(`${CONTENT_MOUNT}/binding-1/fragments`, {
      method: 'GET', headers: SOURCE_HEADERS,
    });
    expect((await wrongMethod.json()).code).toBe('relay_scope_refused');
  });
});

describe('CHAIN-MOUNT upgrade isolation and middleware separation', () => {
  const upgradePath = `${RELAY_MOUNT}/tunnels/tun-1`;
  const preparePath = `${RELAY_MOUNT}/routes`;

  it('should admit exactly one prepared tunnel upgrade and refuse replay', async () => {
    const fake = createFakeASessionContentReceiver({ tunnels: createFakeATunnelRegistry([tunnelFixture()]) });
    const res = await fake.app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-session-relay-upgrade')).toBe('admitted');
    expect(res.headers.get('sec-websocket-protocol')).toBe(RELAY_WSS_SUBPROTOCOL);
    const replay = await fake.app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect(replay.status).toBe(409);
    expect((await replay.json()).code).toBe('relay_stale_generation');
  });

  it('should refuse cookies, Origin, wrong audience and wrong protocol before upgrade or body allocation', async () => {
    const tunnels = createFakeATunnelRegistry([tunnelFixture()]);
    const fake = createFakeASessionContentReceiver({ tunnels });
    const cookie = await fake.app.request(upgradePath, {
      method: 'GET', headers: { ...UPGRADE_HEADERS, cookie: 'session=x' },
    });
    expect((await cookie.json()).code).toBe('relay_origin_refused');
    const origin = await fake.app.request(upgradePath, {
      method: 'GET', headers: { ...UPGRADE_HEADERS, origin: 'https://evil.example' },
    });
    expect((await origin.json()).code).toBe('relay_origin_refused');
    const wrongAudience = await createFakeASessionContentReceiver({
      tunnels: createFakeATunnelRegistry([tunnelFixture({ audience: 'other-audience' })]),
    }).app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect(wrongAudience.status).toBe(401);
    expect((await wrongAudience.json()).code).toBe('relay_auth_required');
    const wrongProtocol = await fake.app.request(upgradePath, {
      method: 'GET', headers: { ...UPGRADE_HEADERS, 'sec-websocket-protocol': 'h2' },
    });
    expect(wrongProtocol.status).toBe(400);
    expect((await wrongProtocol.json()).code).toBe('relay_protocol_refused');
    expect(wrongProtocol.headers.get('x-session-relay-upgrade')).toBeNull();
    const noUpgrade = await fake.app.request(upgradePath, {
      method: 'GET', headers: { 'sec-websocket-protocol': RELAY_WSS_SUBPROTOCOL, 'x-fake-a-installation': FAKE_A_INSTANCE_ID },
    });
    expect((await noUpgrade.json()).code).toBe('relay_protocol_refused');
    // Machine mount on POST /routes: same cookie/Origin refusal before body acquisition.
    const prepareCookie = await fake.app.request(preparePath, {
      method: 'POST', headers: { ...INSTALL_HEADERS, cookie: 'session=x', 'content-type': 'application/json' }, body: '{}',
    });
    expect((await prepareCookie.json()).code).toBe('relay_origin_refused');
    const prepareNoAuth = await fake.app.request(preparePath, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(prepareNoAuth.status).toBe(401);
    expect((await prepareNoAuth.json()).code).toBe('relay_auth_required');
  });

  it('should refuse stale, foreign and unknown tunnels before upgrade', async () => {
    const stale = await createFakeASessionContentReceiver({
      tunnels: createFakeATunnelRegistry([tunnelFixture({ expiresAt: NOW - 1 })]),
    }).app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect(stale.status).toBe(410);
    expect((await stale.json()).code).toBe('relay_grant_expired');
    const foreignAdjacency = await createFakeASessionContentReceiver({
      tunnels: createFakeATunnelRegistry([tunnelFixture({ adjacency: { fromInstanceId: 'mesh-b', toInstanceId: 'other-instance' } })]),
    }).app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect((await foreignAdjacency.json()).code).toBe('relay_scope_refused');
    const unknown = await createFakeASessionContentReceiver({})
      .app.request(`${RELAY_MOUNT}/tunnels/tun-unknown`, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect((await unknown.json()).code).toBe('relay_scope_refused');
  });

  it('should keep the product receiver fail-closed on every source-gap and reject source-only browser credentials', async () => {
    const product = createProductSessionContentReceiver();
    const prepare = await product.app.request(preparePath, {
      method: 'POST', headers: { ...INSTALL_HEADERS, 'content-type': 'application/json' }, body: '{}',
    });
    expect(prepare.status).toBe(503);
    expect((await prepare.json()).code).toBe('relay_grant_unavailable'); // DEP-FED source-gap
    const upgrade = await product.app.request(upgradePath, { method: 'GET', headers: { ...UPGRADE_HEADERS } });
    expect(upgrade.status).toBe(503);
    expect((await upgrade.json()).code).toBe('relay_grant_unavailable');
    const inner = await product.app.request(`${CONTENT_MOUNT}/binding-1/source/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...SOURCE_HEADERS }, body: '{}',
    });
    expect(inner.status).toBe(401); // no public direct access to the virtual inner mount
    expect((await inner.json()).code).toBe('relay_auth_required');
    const browserSourceOnly = await product.app.request(`${REMOTE_MOUNT}/sessions`, {
      method: 'GET', headers: { authorization: 'Bearer source-only-credential' },
    });
    expect(browserSourceOnly.status).toBe(401);
    expect((await browserSourceOnly.json()).code).toBe('authentication_required');
    const browserNoSession = await product.app.request(`${REMOTE_MOUNT}/sessions`, { method: 'GET' });
    expect((await browserNoSession.json()).code).toBe('authentication_required');
  });
});
