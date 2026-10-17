import { describe, expect, it, vi } from 'vitest';
import { canRequestHistory, ConsentFlow, createOffer, keyboardContext, viewAccess } from '$lib/session-content/state';
import { contentApi } from '$lib/session-content/api';
import { apiRequest } from '$lib/utils/api';
import { getApiAuthToken } from '@sentropic/cowork-bridge/core';

vi.mock('$lib/utils/api', () => ({ apiRequest: vi.fn(async () => ({ items: [] })) }));
vi.mock('@sentropic/cowork-bridge/core', () => ({ getApiAuthToken: vi.fn(() => null) }));

const challenge = () => ({ native: { protocol: 'h2a.session-content' as const, protocolVersion: 2 as const,
  kind: 'confirmation-challenge' as const, challengeDigest: 'a'.repeat(64), challenge: {
    id: crypto.randomUUID(), owner: { issuer: 'https://idp.example', subject: 'owner' },
    project: { tenantId: 'tenant', workspaceId: 'workspace', workspaceIncarnation: 'wi', projectId: 'project' },
    source: { workstationId: 'ws', bindingId: 'binding', bindingVersion: 1, sourceId: 'source',
      sourceGeneration: 'source', sourceBootId: 'boot' }, clientId: 'confirmation',
    purpose: 'share' as const, target: { kind: 'policy' as const, policyDigest: 'b'.repeat(64) },
    random: 'r'.repeat(43), issuedAt: Date.now(), expiresAt: Date.now() + 60000,
  } }, authorization: { url: 'https://idp.example/authorize', state: 's'.repeat(43) } });

const scope = { ownerId: 'owner', workspaceId: 'workspace', projectId: 'project', sourceId: 'source' };
const session = {
  ...scope, bindingId: 'binding', sessionId: 'session', status: 'attached' as const,
  sourceAvailable: true, liveAuthorized: true, storedAuthorized: true,
  historyAuthorized: false, retained: true, excluded: false,
  projectRevision: 2, grantProjectRevision: 2, expiresAt: null,
};

describe('session content authorization', () => {
  it.each(['share', 'amend'] as const)('should require native-bound %s confirmation then explicit acceptance without a risk receipt', async (purpose) => {
    const prepared = challenge(); prepared.native.challenge.purpose = purpose;
    const proof = { challengeId: prepared.native.challenge.id,
      challengeDigest: prepared.native.challengeDigest, idToken: 'synthetic-idp-proof' };
    const offer = createOffer(scope); offer.channels['terminal.live'] = true; offer.futureSessions = true;
    const api = { prepare: vi.fn(async () => prepared), prove: vi.fn(async () => proof),
      accept: vi.fn(), available: () => true };
    const flow = new ConsentFlow(offer, api);
    await flow.confirm(); expect(api.accept).not.toHaveBeenCalled();
    await flow.prepare(); await flow.confirm(); expect(api.accept).not.toHaveBeenCalled();
    await flow.authenticate(); expect(api.accept).not.toHaveBeenCalled();
    await flow.confirm(); await flow.confirm();
    expect(api.prove).toHaveBeenCalledTimes(1); expect(api.accept).toHaveBeenCalledTimes(1);
    expect(api.accept).toHaveBeenCalledWith(offer, prepared, proof);
    flow.edit({ ...offer, futureSessions: false }); await flow.confirm();
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it('should use first-party cookies, a CSRF header and no-store for scoped requests', async () => {
    await contentApi.prepareOffer(createOffer(scope));
    expect(apiRequest).toHaveBeenCalledWith('/auth/session/content/workspaces/workspace/consent/prepare',
      expect.objectContaining({ method: 'POST', cache: 'no-store',
        headers: { 'X-Session-Content': 'browser' }, body: JSON.stringify(createOffer(scope)) }));
  });

  it('should refuse a bearer environment and keep membership-free cleanup metadata-only', async () => {
    vi.mocked(getApiAuthToken).mockReturnValueOnce('extension-token');
    await expect(contentApi.metadata('workspace')).rejects.toThrow('first_party_required');
    expect(apiRequest).not.toHaveBeenCalled();
    await contentApi.retained();
    await contentApi.purge({ bindingId: 'binding', retainedScopeId: 'opaque:handle' });
    expect(apiRequest).toHaveBeenLastCalledWith(
      '/auth/session/content/binding/consent?retainedScopeId=opaque%3Ahandle',
      expect.objectContaining({ method: 'DELETE', cache: 'no-store' }));
  });

  it('should start independent channels off and name only explicitly selected histories', () => {
    const offer = createOffer(scope);
    expect(Object.values(offer.channels)).toEqual([false, false, false, false]);
    expect(offer.namedHistories).toEqual([]);
    expect(offer.selectedSessionIds).toEqual([]);
    expect(offer).not.toHaveProperty('offlineReadAccepted');
  });

  it('should project only scope fields from metadata into a consent policy or access comparison', () => {
    const metadata = { ...scope, items: [session], credentials: ['not-a-policy-field'] };
    expect(createOffer(metadata)).not.toHaveProperty('items');
    expect(createOffer(metadata)).not.toHaveProperty('credentials');
    expect(viewAccess(session, metadata)).toMatchObject({ live: true, stored: true });
  });

  it('should cancel an offer without activation and invalidate an in-flight preparation', async () => {
    let resolve!: (value: ReturnType<typeof challenge>) => void;
    const accept = vi.fn();
    const flow = new ConsentFlow(createOffer(scope), {
      prepare: vi.fn(() => new Promise((r) => { resolve = r; })), accept,
      prove: vi.fn(), available: () => true,
    });
    const pending = flow.prepare();
    flow.cancel();
    resolve(challenge());
    await pending;
    expect(flow.prepared).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });

  it('should refuse preparation without a verified source or available IdP confirmation integration', async () => {
    const prepare = vi.fn();
    const flow = new ConsentFlow(createOffer(scope), {
      prepare, accept: vi.fn(), prove: vi.fn(), available: () => false,
    });
    await flow.prepare();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('should separate current live capture from stored and closed-history reading', () => {
    expect(viewAccess(session, scope)).toMatchObject({ live: true, stored: true });
    expect(viewAccess({ ...session, sourceAvailable: false }, scope))
      .toMatchObject({ live: false, stored: true, reason: 'source_unavailable' });
    expect(viewAccess({ ...session, status: 'ended' }, scope))
      .toMatchObject({ live: false, stored: false, reason: 'history_authorization_required' });
    expect(viewAccess({ ...session, status: 'ended', historyAuthorized: true }, scope))
      .toMatchObject({ live: false, stored: true });
  });

  it('should pause stale capture while retaining old-copy readability after an amendment', () => {
    expect(viewAccess({ ...session, grantProjectRevision: 1 }, scope))
      .toMatchObject({ live: false, stored: true, reason: 'project_revision_changed' });
  });

  it('should offer distinct history authorization only for a current eligible owner and retained scope', () => {
    expect(canRequestHistory({ ...session, status: 'ended', sourceAvailable: false, excluded: true }, scope)).toBe(true);
    for (const change of [{ ownerId: 'other' }, { sourceId: 'other' }, { workspaceId: 'other' },
      { projectId: 'other' }, { revoked: true }, { membershipActive: false },
      { historyAuthorized: true }, { expiresAt: 0 }]) {
      expect(canRequestHistory({ ...session, ...change }, scope)).toBe(false);
    }
  });

  it('should keep controller metadata disabled across owner, binding and project mismatches', () => {
    const control = { ownerId: scope.ownerId, workspaceId: scope.workspaceId, bindingId: session.bindingId,
      bindingVersion: 1, sourceGeneration: 'source', incarnation: 'incarnation', projectRevision: 2,
      controllerEpoch: 1, sourceAvailable: true, liveAuthorized: true, authenticationState: 'step_up_required' as const, confirmationAvailable: true };
    expect(keyboardContext(session, scope, control, true)).toEqual(control);
    expect(keyboardContext(session, scope, control, false)).toBeNull();
    for (const change of [{ ownerId: 'other' }, { workspaceId: 'other' }, { bindingId: 'other' }, { projectRevision: 1 }]) {
      expect(keyboardContext(session, scope, { ...control, ...change }, true)).toBeNull();
    }
    expect(keyboardContext({ ...session, status: 'ended' }, scope, control, true)).toBeNull();
    expect(keyboardContext({ ...session, excluded: true }, scope, control, true)).toBeNull();
  });

  it.each(['ownerId', 'workspaceId', 'sourceId', 'projectId'] as const)(
    'should deny a mismatched %s and keep capture exclusion independent from retained reads', (field) => {
      expect(viewAccess({ ...session, [field]: 'elsewhere' }, scope))
        .toMatchObject({ live: false, stored: false });
      expect(viewAccess({ ...session, excluded: true }, scope))
        .toMatchObject({ live: false, stored: true, reason: 'session_excluded' });
    },
  );
});
