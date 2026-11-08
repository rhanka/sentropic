import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents } from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../../src/services/workspace-service';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';

// A1 (prod A4 prerequisite): a non-member of the sentropic tenant must be able to store an
// offline consent for a tenant-optional client (the immo-mcp connector), with no `tid`.
const base = 'http://localhost:9197/api/v1/oauth';
const verifier = 'optional-tenant-consent-pkce-verifier-256-bits';
const redirect = 'https://client.test/callback';
const resource = 'https://immo.test/mcp';
const optionalClient = 'consent-tenant-optional';
const boundClient = 'consent-tenant-bound';
let cookie = '';
let userId = '';

const post = (clientId: string, endpoint: string, values: Record<string, string>) =>
  app.request(`${base}/${endpoint}`, {
    method: 'POST', body: new URLSearchParams({ client_id: clientId, ...values }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: cookie },
  });
const authorize = async (clientId: string) => new URL((await app.request(`${base}/authorize?${new URLSearchParams({
  client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: 'openid offline_access', resource,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
})}`, { headers: { Cookie: cookie } })).headers.get('location')!);
const approve = async (clientId: string) => {
  const consent = await authorize(clientId);
  expect(consent.searchParams.get('code')).toBeNull();
  return post(clientId, 'consent/decision', { decision: 'approve', state: consent.searchParams.get('state')! });
};
const issue = async (clientId: string) => {
  const approval = await approve(clientId);
  expect(approval.status).toBe(302);
  const code = new URL(approval.headers.get('location')!).searchParams.get('code')!;
  const token = await post(clientId, 'token', { grant_type: 'authorization_code', code, code_verifier: verifier,
    redirect_uri: redirect });
  expect(token.status).toBe(200);
  return token.json() as Promise<{ access_token: string; refresh_token: string }>;
};
const refresh = (clientId: string, token: string) =>
  post(clientId, 'token', { grant_type: 'refresh_token', refresh_token: token });
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
const consents = (clientId: string) => db.select().from(oauthConsents).where(eq(oauthConsents.clientId, clientId));
const authority = (clientId: string) => cmQuery(
  `SELECT * FROM ${cmTable('cm_oauth_consents')} WHERE client_id = $1 AND revoked_at IS NULL`, [clientId]);

describe('OAuth consent with an optional tenant (A1)', () => {
  beforeEach(async () => {
    for (const [clientId, requireTenant] of [[optionalClient, false], [boundClient, true]] as const) {
      await db.insert(oauthClients).values({ id: clientId, clientId, name: clientId, redirectUris: [redirect],
        allowedScopes: ['openid', 'offline_access'], resourceIndicators: [resource],
        grantTypes: ['authorization_code', 'refresh_token'], tokenEndpointAuthMethod: 'none', requirePkce: true,
        requireTenant });
    }
    const user = await createTestUser({ withSession: true, withWorkspace: false, role: 'editor' });
    userId = user.id; cookie = `session=${user.sessionToken}`;
    await cmQuery(`INSERT INTO ${cmTable('cm_tenants')} (tenant_id, slug, status, created_at)
      VALUES ($1, $1, 'active', $2) ON CONFLICT (tenant_id) DO NOTHING`, [PLATFORM_TENANT_ID, new Date().toISOString()]);
    const keys = createJwksAdapter();
    if (!await keys.getActiveKey()) await keys.generateAndStoreNewKey({ kid: 'optional-tenant-kid' });
  });
  afterEach(async () => {
    await cmQuery(`DELETE FROM ${cmTable('cm_oauth_consents')} WHERE client_id = ANY($1)`, [[optionalClient, boundClient]]);
    await db.delete(oauthClients).where(inArray(oauthClients.clientId, [optionalClient, boundClient]));
    await cleanupAuthData();
  });

  it('should store a tenant-less offline consent and refresh without tid when a non-member approves a tenant-optional client', async () => {
    const issued = await issue(optionalClient);
    expect(issued.refresh_token).toBeTruthy();
    expect(claims(issued.access_token).tid).toBeUndefined();
    const [row] = await consents(optionalClient);
    expect(row).toMatchObject({ userId, tenantId: null, approvedResources: [resource] });
    expect(row.offlineGrantId).toBeTruthy();
    expect(await authority(optionalClient)).toHaveLength(1);
    const rotated = await refresh(optionalClient, issued.refresh_token);
    expect(rotated.status).toBe(200);
    expect(claims((await rotated.json()).access_token).tid).toBeUndefined();
    // The stored tenant-less grant now covers the request: consent is skipped.
    expect((await authorize(optionalClient)).searchParams.get('code')).toBeTruthy();
  });

  it('should refuse offline consent for a tenant-bound client when the user has no approved membership', async () => {
    const approval = await approve(boundClient);
    expect(approval.status).toBe(400);
    expect(await approval.json()).toMatchObject({ error: 'invalid_grant',
      error_description: 'Local offline consent is required.' });
    expect(await consents(boundClient)).toEqual([]);
    expect(await authority(boundClient)).toEqual([]);
  });

  it('should keep the tenant-keyed grant of a member apart from a later tenant-less grant', async () => {
    await setCmMembershipState(userId, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: userId });
    const member = await issue(optionalClient);
    expect(claims(member.access_token).tid).toBe(PLATFORM_TENANT_ID);
    await setCmMembershipState(userId, PLATFORM_TENANT_ID, { status: 'suspended', decidedBy: userId });
    expect((await refresh(optionalClient, member.refresh_token)).status).toBe(400);
    const tenantless = await issue(optionalClient);
    expect(claims(tenantless.access_token).tid).toBeUndefined();
    expect((await consents(optionalClient)).map(row => row.tenantId).sort())
      .toEqual([PLATFORM_TENANT_ID, null].sort());
    expect(await authority(optionalClient)).toHaveLength(2);
  });

  it('should revoke the tenant-less refresh family when its consent is withdrawn', async () => {
    const issued = await issue(optionalClient);
    await db.delete(oauthConsents).where(eq(oauthConsents.clientId, optionalClient));
    expect((await refresh(optionalClient, issued.refresh_token)).status).toBe(400);
  });

  it('should revoke tenant-less refresh families when the client becomes tenant-bound', async () => {
    const issued = await issue(optionalClient);
    await db.update(oauthClients).set({ requireTenant: true }).where(eq(oauthClients.clientId, optionalClient));
    expect((await refresh(optionalClient, issued.refresh_token)).status).toBe(400);
  });
});
