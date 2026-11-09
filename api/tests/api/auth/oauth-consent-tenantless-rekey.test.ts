import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '../../../src/db/client';
import { oauthClients, oauthConsents } from '../../../src/db/schema';
import { revokeCmOAuthConsent } from '../../../src/services/auth/consent-store-adapter';
import { cmTenantlessOAuthConsentId } from '../../../src/services/auth/oauth-consent-key';
import { cmOAuthConsentId } from '../../../src/services/identity/cm-import-tenancy';
import { setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID as TENANT } from '../../../src/services/workspace-service';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { CONSENT_FLOW_REDIRECT, CONSENT_FLOW_RESOURCE, createConsentFlow, ensureSigningKey, refreshFamilies }
  from '../../utils/oauth-consent-flow';

// Control 0022 A1-REKEY: a pre-0022 grant that only the tenant default keyed survives as a tenant-less grant.
const optionalClient = 'rekey-tenant-optional';
const boundClient = 'rekey-tenant-bound';
let cookie = '';
let userId = '';
const { authorize, issue, refresh } = createConsentFlow(() => cookie);
const cm = async (consentId: string) => (await cmQuery(`SELECT tenant_id, granted_at, revoked_at
  FROM ${cmTable('cm_oauth_consents')} WHERE consent_id = $1`, [consentId]))[0];
const tenantRow = async (user: string, clientId: string) => (await db.select().from(oauthConsents)
  .where(and(eq(oauthConsents.userId, user), eq(oauthConsents.clientId, clientId))))[0];
const seedKeyedAuthority = (user: string, clientId: string, revokedAt: string | null, grantedAt = new Date().toISOString()) =>
  cmQuery(`INSERT INTO ${cmTable('cm_oauth_consents')} (consent_id, tenant_id, user_id, client_id, granted_at, revoked_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, [cmOAuthConsentId(user, clientId, TENANT), TENANT, user, clientId, grantedAt, revokedAt]);
const rekey = async () => {
  const migration = await readFile(new URL('../../../drizzle/control/0022_oauth_consent_optional_tenant.sql', import.meta.url), 'utf8');
  await pool.query(migration.split('--> statement-breakpoint').find(statement => statement.includes('-- A1-REKEY:'))!);
};

describe('tenant-less consent rekey and withdrawal (A1)', () => {
  beforeEach(async () => {
    for (const [clientId, requireTenant] of [[optionalClient, false], [boundClient, true]] as const) {
      await db.insert(oauthClients).values({ id: clientId, clientId, name: clientId, redirectUris: [CONSENT_FLOW_REDIRECT],
        allowedScopes: ['openid', 'offline_access'], resourceIndicators: [CONSENT_FLOW_RESOURCE],
        grantTypes: ['authorization_code', 'refresh_token'], tokenEndpointAuthMethod: 'none', requireTenant });
    }
    const user = await createTestUser({ withSession: true, withWorkspace: false, role: 'editor' });
    userId = user.id; cookie = `session=${user.sessionToken}`;
    await cmQuery(`INSERT INTO ${cmTable('cm_tenants')} (tenant_id, slug, status, created_at)
      VALUES ($1, $1, 'active', $2) ON CONFLICT (tenant_id) DO NOTHING`, [TENANT, new Date().toISOString()]);
    await ensureSigningKey('rekey-tenant-kid');
  });
  afterEach(async () => {
    await cmQuery(`DELETE FROM ${cmTable('cm_oauth_consents')} WHERE client_id = ANY($1)`, [[optionalClient, boundClient]]);
    await db.delete(oauthClients).where(inArray(oauthClients.clientId, [optionalClient, boundClient]));
    await cleanupAuthData();
  });

  it('should move a non-member tenant-keyed grant to the tenant-less key with its offline evidence and family', async () => {
    const issued = await issue(optionalClient);
    const tenantless = cmTenantlessOAuthConsentId(userId, optionalClient);
    const { granted_at: grantedAt } = await cm(tenantless);
    // Pre-0022 shape: the row and its CM authority were keyed by the tenant default.
    await db.update(oauthConsents).set({ tenantId: TENANT }).where(eq(oauthConsents.clientId, optionalClient));
    await cmQuery(`DELETE FROM ${cmTable('cm_oauth_consents')} WHERE consent_id = $1`, [tenantless]);
    await seedKeyedAuthority(userId, optionalClient, null, grantedAt);
    const before = await tenantRow(userId, optionalClient);
    expect((await authorize(optionalClient)).searchParams.get('code')).toBeNull();
    await rekey();
    expect(await tenantRow(userId, optionalClient)).toMatchObject({ tenantId: null, offlineGrantId: before.offlineGrantId });
    expect(await cm(tenantless)).toMatchObject({ tenant_id: TENANT, granted_at: grantedAt, revoked_at: null });
    expect((await cm(cmOAuthConsentId(userId, optionalClient, TENANT))).revoked_at).toBeTruthy();
    expect((await refresh(optionalClient, issued.refresh_token)).status).toBe(200);
    expect((await authorize(optionalClient)).searchParams.get('code')).toBeTruthy();
  });

  it('should leave tenant-bound, member and revoked grants keyed as they are', async () => {
    const member = await createTestUser({ withWorkspace: false });
    await setCmMembershipState(member.id, TENANT, { status: 'approved', role: 'member', decidedBy: member.id });
    const seeded: Array<[string, string, string | null]> = [[userId, boundClient, null],
      [member.id, optionalClient, null], [userId, optionalClient, new Date().toISOString()]];
    for (const [user, clientId, revokedAt] of seeded) {
      await db.insert(oauthConsents).values({ userId: user, clientId, tenantId: TENANT, scopes: ['openid'] });
      await seedKeyedAuthority(user, clientId, revokedAt);
    }
    await rekey();
    for (const [user, clientId, revokedAt] of seeded) {
      expect((await tenantRow(user, clientId)).tenantId).toBe(TENANT);
      expect((await cm(cmOAuthConsentId(user, clientId, TENANT))).revoked_at).toBe(revokedAt);
      expect(await cm(cmTenantlessOAuthConsentId(user, clientId))).toBeUndefined();
    }
  });

  it('should withdraw a tenant-less consent through the product helper', async () => {
    await issue(optionalClient);
    expect(await revokeCmOAuthConsent({ userId, clientId: optionalClient })).toBe(true);
    expect(await tenantRow(userId, optionalClient)).toBeUndefined();
    expect((await cm(cmTenantlessOAuthConsentId(userId, optionalClient))).revoked_at).toBeTruthy();
    expect(await refreshFamilies(userId, optionalClient)).toEqual([{ tenant_id: null, revoked_reason: 'consent_revoked' }]);
  });
});
