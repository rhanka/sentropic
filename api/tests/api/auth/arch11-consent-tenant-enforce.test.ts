import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

import { app } from '../../../src/app';
import { env } from '../../../src/config/env';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthConsents,
  oauthTokens,
  revokedTokens,
  tenantMemberships,
  tenants,
} from '../../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

// ARCH-11 G1c (spec §4.2.5 / §1.5) — consent tenant enforcement end-to-end. DEFAULT (shadow) is
// byte-identical (the tenant leg is ignored; a single 'sentropic' row; org-B reuses the grant like
// pre-G1c). STRICT enforces the tenant leg: the SAME user's org-A grant NEVER skips consent in
// org-B (NON-VACUOUS §1.5), and approving each org writes a DISTINCT row.

const CLIENT_ID = 'arch11g1c-consent-rp';
const REDIRECT_URI = 'http://localhost:5397/auth/oauth/callback';
const CODE_VERIFIER = 'test-code-verifier-with-enough-entropy-1234567890';
const ORG_A = 'arch11g1c-consent-org-a';
const ORG_B = 'arch11g1c-consent-org-b';
const TEST_ORGS = [ORG_A, ORG_B];

const originalMode = env.TENANT_RESOLUTION_MODE;

describe('ARCH-11 G1c — OAuth consent tenant enforcement', () => {
  beforeEach(async () => {
    for (const org of TEST_ORGS) {
      await db.insert(tenants).values({ id: org, name: org, status: 'active' }).onConflictDoNothing();
    }
    await seedOauthClient();
  });

  afterEach(async () => {
    env.TENANT_RESOLUTION_MODE = originalMode;
    await db.delete(oauthConsents).where(eq(oauthConsents.clientId, CLIENT_ID));
    await db.delete(authorizationCodes).where(eq(authorizationCodes.clientId, CLIENT_ID));
    await db.delete(oauthTokens).where(eq(oauthTokens.clientId, CLIENT_ID));
    await db.delete(revokedTokens).where(eq(revokedTokens.clientId, CLIENT_ID));
    await db.delete(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
    // Delete the seeded user FIRST: tenant_memberships cascade on the user FK (never a broad
    // `delete ... where tenant_id='sentropic'`, which would nuke OTHER parallel tests' memberships
    // and break the G1a orphan invariant). ORG_A/ORG_B rows cascade-delete their memberships too.
    await cleanupAuthData();
    await db.delete(tenants).where(inArray(tenants.id, TEST_ORGS));
  });

  it('DEFAULT (shadow): byte-identical — a single sentropic row; org-B reuses the org-A grant', async () => {
    env.TENANT_RESOLUTION_MODE = 'shadow';
    const { cookie, userId } = await seedMultiOrgUser();

    // Approve under ?tenant=org-a.
    await approve(cookie, ORG_A);
    // Under shadow the tenant leg is ignored → exactly ONE row, keyed to the DEFAULT 'sentropic'.
    const rows = await allRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe('sentropic');

    // org-B authorize SKIPS consent (reuses by (user, client) — the pre-G1c behavior).
    const orgB = await authorize(cookie, 'openid profile email', ORG_B);
    const loc = new URL(orgB.headers.get('location') ?? '');
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT_URI);
    expect(loc.searchParams.get('code')).toBeTruthy();
  });

  it('STRICT (NON-VACUOUS §1.5): the org-A grant NEVER skips consent in org-B; distinct rows', async () => {
    env.TENANT_RESOLUTION_MODE = 'strict';
    const { cookie, userId } = await seedMultiOrgUser();

    // Approve under ?tenant=org-a → a row keyed to org-A.
    await approve(cookie, ORG_A);
    // org-A re-authorize SKIPS consent (covered, same tenant).
    const orgAReauth = await authorize(cookie, 'openid profile email', ORG_A);
    const orgALoc = new URL(orgAReauth.headers.get('location') ?? '');
    expect(`${orgALoc.origin}${orgALoc.pathname}`).toBe(REDIRECT_URI);
    expect(orgALoc.searchParams.get('code')).toBeTruthy();

    // org-B authorize RE-SHOWS consent — the org-A grant is NOT reused (§1.5 fix).
    const orgB = await authorize(cookie, 'openid profile email', ORG_B);
    const orgBLoc = new URL(orgB.headers.get('location') ?? '');
    expect(`${orgBLoc.origin}${orgBLoc.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
    expect(orgBLoc.searchParams.get('code')).toBeNull();

    // Approve org-B too → a SECOND, distinct row.
    await approve(cookie, ORG_B);
    const rows = await allRows(userId);
    expect(rows.map((r) => r.tenantId).sort()).toEqual([ORG_A, ORG_B].sort());
  });
});

// --- helpers ---

const seedMultiOrgUser = async (): Promise<{ cookie: string; userId: string }> => {
  const user = await createTestUser({
    displayName: 'G1c Consent User',
    role: 'editor',
    withSession: true,
    withWorkspace: false,
  });
  // Approved in BOTH orgs; a suspended 'sentropic' membership satisfies the G1a orphan invariant
  // without affecting approved-only derivation.
  await db.insert(tenantMemberships).values([
    { tenantId: ORG_A, userId: user.id, status: 'approved', role: 'member' },
    { tenantId: ORG_B, userId: user.id, status: 'approved', role: 'member' },
    { tenantId: 'sentropic', userId: user.id, status: 'suspended', role: 'member' },
  ]).onConflictDoNothing();
  return { cookie: `session=${user.sessionToken}`, userId: user.id };
};

const authorize = (cookie: string, scope: string, tenant: string): Promise<Response> => {
  const url = new URL('http://localhost:9197/api/v1/auth/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', scope);
  url.searchParams.set('code_challenge', createHash('sha256').update(CODE_VERIFIER).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'rp-state-1');
  url.searchParams.set('nonce', 'nonce-1');
  url.searchParams.set('tenant', tenant);
  return app.request(url.toString(), { headers: { Cookie: cookie } });
};

const approve = async (cookie: string, tenant: string): Promise<void> => {
  const authorizeResponse = await authorize(cookie, 'openid profile email', tenant);
  const sealedState = new URL(authorizeResponse.headers.get('location') ?? '').searchParams.get('state') ?? '';
  expect(sealedState).toBeTruthy();
  const decision = await app.request('http://localhost:9197/api/v1/auth/oauth/consent/decision', {
    body: JSON.stringify({ decision: 'approve', state: sealedState }),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie },
    method: 'POST',
  });
  expect(decision.status).toBe(200);
};

const allRows = async (userId: string): Promise<{ tenantId: string }[]> =>
  db
    .select({ tenantId: oauthConsents.tenantId })
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, CLIENT_ID)));

const seedOauthClient = async (): Promise<void> => {
  const now = new Date();
  const values = {
    allowedScopes: ['openid', 'profile', 'email', 'offline'],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update('arch11g1c-consent-secret-dev-only').digest('hex'),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: 'arch11g1c-consent-client',
    name: 'G1c Consent RP',
    redirectUris: [REDIRECT_URI],
    requirePkce: true,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    updatedAt: now,
  };
  await db.insert(oauthClients).values(values).onConflictDoUpdate({
    set: { allowedScopes: values.allowedScopes, redirectUris: values.redirectUris, updatedAt: now },
    target: oauthClients.clientId,
  });
};
