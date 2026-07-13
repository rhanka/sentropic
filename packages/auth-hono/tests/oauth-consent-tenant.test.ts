import { describe, expect, it } from 'vitest';

import type { AuthHonoConsentGrant, AuthHonoConsentStorePort } from '../src/index.js';
import { authorizePath, createOauthPorts, createOauthRouterForTest } from './__fixtures__/oauth-fixtures.js';

// ARCH-11 G1c (spec §4.2.5 / §1.5): the authorize handler threads the org the request is scoped to
// (derived from `?tenant=` against approved memberships) into getGrant/saveGrant. A tenant-keyed
// consent store then proves the §1.5 fix: the SAME user's org-A grant NEVER skips consent in org-B.

const USER_ID = 'user-1';
const CLIENT_ID = 'example-rp';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

/** Tenant-keyed in-memory consent store — the enforcement a strict api adapter provides. */
const createTenantConsentStore = (): AuthHonoConsentStorePort & {
  read(userId: string, clientId: string, tenantId: string): AuthHonoConsentGrant | null;
} => {
  const grants = new Map<string, Set<string>>();
  const key = (u: string, c: string, t: string | undefined) => `${u}|${c}|${t ?? ''}`;
  return {
    async getGrant(userId, clientId, tenantId) {
      const set = grants.get(key(userId, clientId, tenantId));
      return set ? { scopes: [...set] } : null;
    },
    async saveGrant(userId, clientId, scopes, tenantId) {
      const existing = grants.get(key(userId, clientId, tenantId)) ?? new Set<string>();
      for (const s of scopes) existing.add(s);
      grants.set(key(userId, clientId, tenantId), existing);
    },
    read(userId, clientId, tenantId) {
      const set = grants.get(key(userId, clientId, tenantId));
      return set ? { scopes: [...set] } : null;
    },
  };
};

const withTenantPorts = async (consentStore: AuthHonoConsentStorePort) => {
  const { ports } = await createOauthPorts({ authenticated: true });
  ports.consentStore = consentStore;
  ports.tenant = {
    listApprovedTenantIds: async () => [ORG_A, ORG_B],
    isApprovedMember: async (_userId, tenantId) => tenantId === ORG_A || tenantId === ORG_B,
  };
  return createOauthRouterForTest({ ports });
};

describe('OAuth consent tenant enforcement (ARCH-11 G1c §1.5)', () => {
  it('an org-A grant skips consent for org-A but NOT for org-B (same user, two orgs)', async () => {
    const store = createTenantConsentStore();
    await store.saveGrant(USER_ID, CLIENT_ID, ['openid', 'profile', 'email'], ORG_A);
    const { router } = await withTenantPorts(store);

    // org-A: covered grant ⇒ straight to the RP callback with a code (consent skipped).
    const orgA = await router.request(authorizePath({ tenant: ORG_A, nonce: 'n1' }));
    const orgALocation = new URL(orgA.headers.get('location') ?? '');
    expect(`${orgALocation.origin}${orgALocation.pathname}`).toBe('http://localhost:5397/callback');
    expect(orgALocation.searchParams.get('code')).toBeTruthy();

    // org-B: NO grant for org-B ⇒ consent screen (the org-A grant is NOT reused — §1.5 fix).
    const orgB = await router.request(authorizePath({ tenant: ORG_B, nonce: 'n2' }));
    const orgBLocation = new URL(orgB.headers.get('location') ?? '');
    expect(`${orgBLocation.origin}${orgBLocation.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(orgBLocation.searchParams.get('code')).toBeNull();
  });

  it('approve under `?tenant=org-b` records a SEPARATE org-B grant (saveGrant threads the tenant)', async () => {
    const store = createTenantConsentStore();
    const { router } = await withTenantPorts(store);

    const authorize = await router.request(authorizePath({ tenant: ORG_B }));
    const state = new URL(authorize.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const approve = await router.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(approve.status).toBe(200);

    // The grant is recorded under org-B, and org-A stays empty (no cross-tenant leakage).
    expect(store.read(USER_ID, CLIENT_ID, ORG_B)?.scopes.sort()).toEqual(['email', 'openid', 'profile']);
    expect(store.read(USER_ID, CLIENT_ID, ORG_A)).toBeNull();
  });
});
