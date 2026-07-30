import { describe, expect, it } from 'vitest';

import type { AuthHonoConsentGrant, AuthHonoConsentStorePort, AuthHonoPorts } from '../src/index.js';
import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

// ARCH-11 §4.2.4 — the POSITIVE invariant, asserted rather than described:
//
//   every emitted/persisted `tid` MUST be the output of an explicit tenant resolution for the
//   AUTHENTICATED principal; a value arriving by column default, spread/inheritance or fallback
//   is invalid.
//
// This suite exercises the `?continue=` COLD-LOGIN RESUME path, which no test covered before and
// which is the DOMINANT flow (a user without a live session). The continuation is sealed while the
// principal is still unknown, so the tenant derivation necessarily yields null at seal time; the
// resume must RE-derive it once the session identifies the user. Regression guarded: the resume
// re-seal spread `...payload` and did not override `tenantId`, so the stale pre-login null rode
// into the auth code and every token from this flow carried no `tid` at all — silently.
//
// `client.tenantId` is deliberately NON-NULL here. With the shared fixture's `tenantId: null`, an
// implementation that wrongly emitted the CLIENT's tenant would be indistinguishable from one that
// resolved nothing, and the regression would pass green.

const USER_ID = 'user-1';
const CLIENT_ID = 'example-rp';
const CLIENT_TENANT = 'client-tenant';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SCOPES = ['openid', 'profile', 'email'];

/** Tenant-keyed consent store — mirrors what a strict api adapter enforces. */
const createTenantConsentStore = (): AuthHonoConsentStorePort & {
  read(userId: string, clientId: string, tenantId: string | undefined): AuthHonoConsentGrant | null;
  keys(): string[];
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
      for (const scope of scopes) existing.add(scope);
      grants.set(key(userId, clientId, tenantId), existing);
    },
    read(userId, clientId, tenantId) {
      const set = grants.get(key(userId, clientId, tenantId));
      return set ? { scopes: [...set] } : null;
    },
    keys: () => [...grants.keys()],
  };
};

const wireTenantPort = (ports: AuthHonoPorts, approved: string[]): void => {
  ports.tenant = {
    listApprovedTenantIds: async () => approved,
    isApprovedMember: async (_userId: string, tenantId: string) => approved.includes(tenantId),
  };
};

/**
 * Drive the real two-pass cold-login flow: an unauthenticated `/oauth/authorize` seals a login
 * continuation, then the SAME continuation is replayed against an authenticated router — exactly
 * what the login screen does via `?continue=`. Both passes share one state store and one codec.
 */
const coldLoginResume = async (input: {
  approved: string[];
  consentStore: ReturnType<typeof createTenantConsentStore>;
  requestedTenant?: string;
}) => {
  const clients = [createOauthClient({ tenantId: CLIENT_TENANT })];

  const { ports, store } = await createOauthPorts({ clients });
  ports.consentStore = input.consentStore;
  wireTenantPort(ports, input.approved);
  const { router, stateCodec } = createOauthRouterForTest({ ports });

  const initial = await router.request(
    authorizePath(input.requestedTenant ? { tenant: input.requestedTenant } : {})
  );
  const continuation = new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';
  expect(continuation, 'first pass must seal a login continuation').toBeTruthy();

  const { ports: authPorts } = await createOauthPorts({ authenticated: true, store });
  authPorts.consentStore = input.consentStore;
  wireTenantPort(authPorts, input.approved);
  const { router: resumeRouter } = createOauthRouterForTest({ ports: authPorts, stateCodec });

  const resumed = await resumeRouter.request(`/oauth/authorize?continue=${encodeURIComponent(continuation)}`);
  return { resumeRouter, resumed, store };
};

describe('OAuth authorize resume — tenant resolution (ARCH-11 §4.2.4)', () => {
  it('seals the tenant resolved for the AUTHENTICATED principal, not the pre-login null', async () => {
    const consentStore = createTenantConsentStore();
    await consentStore.saveGrant(USER_ID, CLIENT_ID, SCOPES, ORG_A);

    const { resumed, store } = await coldLoginResume({ approved: [ORG_A], consentStore });

    const location = new URL(resumed.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    const code = location.searchParams.get('code') ?? '';
    expect(code).toBeTruthy();

    const payload = await store.consumeAuthCode(code);
    // The invariant itself: the persisted tenant IS the resolution for this principal.
    expect(payload?.tenantId).toBe(ORG_A);
    // The two ways it historically failed, pinned so neither can return silently.
    expect(payload?.tenantId, 'stale pre-login null must not survive the re-seal').not.toBeNull();
    expect(payload?.tenantId, 'the client record tenant is not a resolution').not.toBe(CLIENT_TENANT);
  });

  it('carries an explicit `?tenant=` selection across the login round-trip (multi-org)', async () => {
    // Two approved orgs: without the selection the derivation cannot pick one ("0 or >1 ⇒ null").
    // The resume URL carries `continue` alone, so the choice can only survive inside the sealed
    // continuation. Reading `?tenant=` off the resume request would drop it and emit no `tid`.
    const consentStore = createTenantConsentStore();
    await consentStore.saveGrant(USER_ID, CLIENT_ID, SCOPES, ORG_B);

    const { resumed, store } = await coldLoginResume({
      approved: [ORG_A, ORG_B],
      consentStore,
      requestedTenant: ORG_B,
    });

    const code = new URL(resumed.headers.get('location') ?? '').searchParams.get('code') ?? '';
    expect(code, 'a selected org must still resolve after login').toBeTruthy();
    const payload = await store.consumeAuthCode(code);
    expect(payload?.tenantId).toBe(ORG_B);
  });

  it('an unapproved `?tenant=` selection is refused across the resume, never honored', async () => {
    // The sealed selection is user INTENT, not authorization: it is re-validated against approved
    // memberships on every use. Tamper-proofing via HMAC is not a substitute for that check.
    //
    // A covering grant for an APPROVED org is seeded on purpose. Without it, "consent is shown and
    // no code is issued" would be trivially true — nothing could be issued for ANY tenant, so the
    // assertion would hold even if the refusal were replaced by a silent fallback to some other
    // approved org. Seeding it makes the outcome a POSITIVE witness: refusing resolves the tenant
    // to null, the ORG_A-keyed grant is therefore NOT found, and consent is still required. An
    // implementation that fell back to `approved[0]` would find that grant and issue a code here.
    // Stopping at "consent was shown" is still not enough: an implementation that WRONGLY SEALED
    // `tenantId='org-not-mine'` would also find no covering grant and also land on consent — green
    // for the wrong reason. So the flow is carried through to approval and the EMITTED tenant is
    // measured directly. That is the only assertion that distinguishes "refused" from "honored but
    // unused", and it is positive: the resolution IS null.
    const consentStore = createTenantConsentStore();
    await consentStore.saveGrant(USER_ID, CLIENT_ID, SCOPES, ORG_A);
    const { resumeRouter, resumed, store } = await coldLoginResume({
      approved: [ORG_A],
      consentStore,
      requestedTenant: 'org-not-mine',
    });

    const location = new URL(resumed.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(location.searchParams.get('code'), 'an unapproved selection must not skip consent').toBeNull();

    const state = location.searchParams.get('state') ?? '';
    const approve = await resumeRouter.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(approve.status).toBe(200);

    const code = new URL((await approve.json()).redirectTo ?? '').searchParams.get('code') ?? '';
    expect(code).toBeTruthy();
    const payload = await store.consumeAuthCode(code);
    expect(payload?.tenantId, 'an unapproved selection must resolve to NO tenant').toBeNull();
    expect(
      consentStore.keys().some((k) => k.includes('org-not-mine')),
      'no grant may ever be keyed on an unapproved tenant'
    ).toBe(false);
  });

  it('writes the consent grant under the SAME tenant the skip-check read (no defaulted key)', async () => {
    // F2: the skip-check keyed on the freshly derived tenant while the grant was written from the
    // sealed payload's stale null → the adapter omitted the tenant leg and Postgres applied the
    // `oauth_consents` column default. The user then re-consented on every single authorize,
    // and the rows accreted under the legacy singleton tenant.
    const consentStore = createTenantConsentStore();
    const { resumeRouter, resumed } = await coldLoginResume({ approved: [ORG_A], consentStore });

    const location = new URL(resumed.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    const state = location.searchParams.get('state') ?? '';
    expect(state).toBeTruthy();

    const approve = await resumeRouter.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(approve.status).toBe(200);

    expect(consentStore.read(USER_ID, CLIENT_ID, ORG_A)?.scopes.sort()).toEqual(['email', 'openid', 'profile']);
    // Exactly one key, and it is the tenant-scoped one — no untenanted/defaulted row alongside it.
    expect(consentStore.keys()).toEqual([`${USER_ID}|${CLIENT_ID}|${ORG_A}`]);
  });

  it('a second authorize after consent now SKIPS consent (the grant is findable again)', async () => {
    // The user-visible consequence of the save/read mismatch: a grant written under one key and
    // looked up under another is never found, so consent reappeared forever. Same store, twice.
    const consentStore = createTenantConsentStore();
    const first = await coldLoginResume({ approved: [ORG_A], consentStore });
    const state = new URL(first.resumed.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await first.resumeRouter.request('/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });

    const second = await coldLoginResume({ approved: [ORG_A], consentStore });
    const location = new URL(second.resumed.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('code')).toBeTruthy();
  });
});
