import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents } from '../../../src/db/schema';
import { createConsentStoreAdapter } from '../../../src/services/auth/consent-store-adapter';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { createCmTenant, setCmMembershipState, setCmTenantStatus } from '../../../src/services/identity/cm-tenancy';
import { runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { cmOAuthConsentId } from '../../../src/services/identity/cm-import-tenancy';
import { cmDeleteForUsers, cmDeleteTenants, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

const userId = 'a4-consent-user';
const clientId = 'a4-consent-client';
const tenantId = 'a4-consent-tenant';
const consentId = cmOAuthConsentId(userId, clientId, tenantId);
const authority = () => cmQuery(`SELECT * FROM ${cmTable('cm_oauth_consents')} WHERE consent_id = $1`, [consentId]);
const protocol = () => db.select().from(oauthConsents).where(eq(oauthConsents.userId, userId));

describe('CM OAuth consent authority and protocol participant', () => {
  const cleanup = async () => {
    await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
    await cmQuery(`DELETE FROM ${cmTable('cm_oauth_consents')} WHERE consent_id = $1`, [consentId]);
    await cmDeleteForUsers([userId]);
    await cmQuery(`DELETE FROM ${cmTable('identity_subject_fences')} WHERE user_id = $1`, [userId]);
    await cmDeleteTenants([tenantId]);
  };
  beforeEach(async () => {
    await cleanup();
    await createCmUser({ userId, email: 'a4-consent@example.test', role: 'editor', emailVerified: true, accountStatus: 'active' });
    await createCmTenant({ tenantId });
    await setCmMembershipState(userId, tenantId, { status: 'approved', decidedBy: userId });
    await db.insert(oauthClients).values({ id: clientId, clientId, name: 'A4 consent',
      redirectUris: ['https://client.test/cb'], allowedScopes: ['read', 'write', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'] });
  });
  afterEach(cleanup);

  it('rolls back both CM authority and protocol evidence after a later failure', async () => {
    await expect(runCmIdentityWrite(async transaction => {
      await createConsentStoreAdapter({ transaction }).saveGrant(userId, clientId, ['read'], tenantId);
      throw new Error('injected_after_consent');
    })).rejects.toThrow('injected_after_consent');
    expect(await protocol()).toEqual([]);
    expect(await authority()).toEqual([]);
  });

  it('commits exact-tenant consent and refuses a revoked CM grant on the next read', async () => {
    await runCmIdentityWrite(async transaction => {
      const port = createConsentStoreAdapter({ transaction });
      await port.saveGrant(userId, clientId, ['read', 'offline_access'], tenantId,
        { issuer: 'https://idp.test', resource: 'https://resource.test/mcp' });
      expect(await port.getGrant(userId, clientId, tenantId)).toMatchObject({ scopes: ['read', 'offline_access'] });
    });
    expect(await authority()).toHaveLength(1);
    await runCmIdentityWrite(async transaction => {
      await transaction.lockSubject(userId);
      await transaction.stores.oauth.revokeConsent(consentId, new Date().toISOString());
      expect(await createConsentStoreAdapter({ transaction }).getGrant(userId, clientId, tenantId)).toBeNull();
    });
  });

  it('never falls back to a default tenant or writes through an unbound participant', async () => {
    await expect(createConsentStoreAdapter().saveGrant(userId, clientId, ['read'], tenantId))
      .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    await expect(runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .saveGrant(userId, clientId, ['read']))).rejects.toMatchObject({ code: 'identity_material_invalid' });
    expect(await protocol()).toEqual([]);
    expect(await authority()).toEqual([]);
  });

  it('does not reuse consent while its tenant is suspended', async () => {
    await runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .saveGrant(userId, clientId, ['read'], tenantId));
    await setCmTenantStatus(tenantId, 'suspended');
    expect(await runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .getGrant(userId, clientId, tenantId))).toBeNull();
  });
});
