import { describe, expect, it, vi } from 'vitest';
import { ConsentFlow, createOffer, viewAccess } from '$lib/session-content/state';
import { contentApi } from '$lib/session-content/api';
import { apiRequest } from '$lib/utils/api';
import { getApiAuthToken } from '@sentropic/cowork-bridge/core';

vi.mock('$lib/utils/api', () => ({ apiRequest: vi.fn(async () => ({ items: [] })) }));
vi.mock('@sentropic/cowork-bridge/core', () => ({ getApiAuthToken: vi.fn(() => null) }));

const scope = { ownerId: 'owner', workspaceId: 'workspace', projectId: 'project', sourceId: 'source' };
const session = {
  ...scope, bindingId: 'binding', sessionId: 'session', status: 'attached' as const,
  sourceAvailable: true, liveAuthorized: true, storedAuthorized: true,
  historyAuthorized: false, retained: true, excluded: false,
  projectRevision: 2, grantProjectRevision: 2, expiresAt: null,
};

describe('session content authorization', () => {
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
    expect(offer.offlineReadAccepted).toBe(false);
  });

  it('should project only scope fields from metadata into a consent policy or access comparison', () => {
    const metadata = { ...scope, items: [session], credentials: ['not-a-policy-field'] };
    expect(createOffer(metadata)).not.toHaveProperty('items');
    expect(createOffer(metadata)).not.toHaveProperty('credentials');
    expect(viewAccess(session, metadata)).toMatchObject({ live: true, stored: true });
  });

  it('should cancel an offer without activation and invalidate an in-flight preparation', async () => {
    let resolve!: (value: unknown) => void;
    const accept = vi.fn();
    const flow = new ConsentFlow(createOffer(scope), {
      prepare: vi.fn(() => new Promise((r) => { resolve = r; })), accept,
      prove: vi.fn(), available: () => true,
    });
    const pending = flow.prepare();
    flow.cancel();
    resolve({ challenge: 'late' });
    await pending;
    expect(flow.prepared).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });

  it('should refuse preparation without a verified source or usable browser key', async () => {
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

  it.each(['ownerId', 'workspaceId', 'sourceId', 'projectId'] as const)(
    'should deny a mismatched %s and let exclusion dominate every capability', (field) => {
      expect(viewAccess({ ...session, [field]: 'elsewhere' }, scope))
        .toMatchObject({ live: false, stored: false });
      expect(viewAccess({ ...session, excluded: true }, scope))
        .toMatchObject({ live: false, stored: false, reason: 'session_excluded' });
    },
  );
});
