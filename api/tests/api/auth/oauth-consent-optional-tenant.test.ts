import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents } from '../../../src/db/schema';
import { setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../../src/services/workspace-service';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { accessClaims as claims, CONSENT_FLOW_REDIRECT, CONSENT_FLOW_RESOURCE, createConsentFlow, ensureSigningKey,
  refreshFamilies } from '../../utils/oauth-consent-flow';

// A1 (prod A4 prerequisite): a non-member of the sentropic tenant must be able to store an
// offline consent for a tenant-optional client (the immo-mcp connector), with no `tid`.
const optionalClient = 'consent-tenant-optional';
const boundClient = 'consent-tenant-bound';
let cookie = '';
let userId = '';
const { authorize, approve, exchange, issue, refresh } = createConsentFlow(() => cookie);
const consents = (clientId: string) => db.select().from(oauthConsents).where(eq(oauthConsents.clientId, clientId));
const authority = (clientId: string) => cmQuery(
  `SELECT * FROM ${cmTable('cm_oauth_consents')} WHERE client_id = $1 AND revoked_at IS NULL`, [clientId]);

describe('OAuth consent with an optional tenant (A1)', () => {
  beforeEach(async () => {
    for (const [clientId, requireTenant] of [[optionalClient, false], [boundClient, true]] as const) {
      await db.insert(oauthClients).values({ id: clientId, clientId, name: clientId, redirectUris: [CONSENT_FLOW_REDIRECT],
        allowedScopes: ['openid', 'offline_access'], resourceIndicators: [CONSENT_FLOW_RESOURCE],
        grantTypes: ['authorization_code', 'refresh_token'], tokenEndpointAuthMethod: 'none', requirePkce: true,
        requireTenant });
    }
    const user = await createTestUser({ withSession: true, withWorkspace: false, role: 'editor' });
    userId = user.id; cookie = `session=${user.sessionToken}`;
    await cmQuery(`INSERT INTO ${cmTable('cm_tenants')} (tenant_id, slug, status, created_at)
      VALUES ($1, $1, 'active', $2) ON CONFLICT (tenant_id) DO NOTHING`, [PLATFORM_TENANT_ID, new Date().toISOString()]);
    await ensureSigningKey('optional-tenant-kid');
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
    expect(row).toMatchObject({ userId, tenantId: null, approvedResources: [CONSENT_FLOW_RESOURCE] });
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

  it('should keep tenant-keyed and tenant-less grants and families apart for the same user and client', async () => {
    const member = () => setCmMembershipState(userId, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: userId });
    await member();
    expect(claims((await issue(optionalClient)).access_token).tid).toBe(PLATFORM_TENANT_ID);
    await setCmMembershipState(userId, PLATFORM_TENANT_ID, { status: 'suspended', decidedBy: userId });
    expect(claims((await issue(optionalClient)).access_token).tid).toBeUndefined();
    await member();
    // The tenant-keyed grant survived the suspension: consent is skipped, the token carries the tid again.
    const keyed = await exchange(optionalClient, (await authorize(optionalClient)).searchParams.get('code')!);
    expect(claims(keyed.access_token).tid).toBe(PLATFORM_TENANT_ID);
    expect((await consents(optionalClient)).map(row => row.tenantId).sort()).toEqual([null, PLATFORM_TENANT_ID].sort());
    expect(await authority(optionalClient)).toHaveLength(2);
    // Withdrawing the tenant-less grant revokes only the tenant-less family.
    await db.delete(oauthConsents).where(and(eq(oauthConsents.clientId, optionalClient), isNull(oauthConsents.tenantId)));
    expect(await refreshFamilies(userId, optionalClient)).toEqual([
      { tenant_id: PLATFORM_TENANT_ID, revoked_reason: 'policy_denied' },
      { tenant_id: null, revoked_reason: 'consent_revoked' },
      { tenant_id: PLATFORM_TENANT_ID, revoked_reason: null }]);
    expect((await refresh(optionalClient, keyed.refresh_token)).status).toBe(200);
  });

  it('should eagerly revoke the tenant-less refresh family when its consent is withdrawn', async () => {
    await issue(optionalClient);
    await db.delete(oauthConsents).where(eq(oauthConsents.clientId, optionalClient));
    expect(await refreshFamilies(userId, optionalClient)).toEqual([{ tenant_id: null, revoked_reason: 'consent_revoked' }]);
  });

  it('should eagerly revoke tenant-less refresh families when the client becomes tenant-bound', async () => {
    const issued = await issue(optionalClient);
    await db.update(oauthClients).set({ requireTenant: true }).where(eq(oauthClients.clientId, optionalClient));
    expect(await refreshFamilies(userId, optionalClient)).toEqual([{ tenant_id: null, revoked_reason: 'policy_denied' }]);
    // Relaxing the policy again does not resurrect the revoked family.
    await db.update(oauthClients).set({ requireTenant: false }).where(eq(oauthClients.clientId, optionalClient));
    expect((await refresh(optionalClient, issued.refresh_token)).status).toBe(400);
  });
});
