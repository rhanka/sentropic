import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents, oauthDpopProofs } from '../../../src/db/schema';
import { createConsentStoreAdapter, revokeCmOAuthConsent } from '../../../src/services/auth/consent-store-adapter';
import { createOauthStateStoreAdapter } from '../../../src/services/auth/oauth-state-adapter';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { createCmTenant, setCmMembershipState, setCmTenantStatus } from '../../../src/services/identity/cm-tenancy';
import { runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { cmOAuthConsentId } from '../../../src/services/identity/cm-import-tenancy';
import { createCmOAuthTenantPort } from '../../../src/services/identity/cm-oauth-tenancy';
import { cmDeleteForUsers, cmDeleteTenants, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

const userId = 'a4-consent-user';
const clientId = 'a4-consent-client';
const tenantId = 'a4-consent-tenant';
const consentId = cmOAuthConsentId(userId, clientId, tenantId);
const authority = () => cmQuery(`SELECT * FROM ${cmTable('cm_oauth_consents')} WHERE consent_id = $1`, [consentId]);
const protocol = () => db.select().from(oauthConsents).where(eq(oauthConsents.userId, userId));

describe('CM OAuth consent authority and protocol participant', () => {
  const cleanup = async () => {
    await db.delete(oauthDpopProofs).where(inArray(oauthDpopProofs.jti, ['a4-unbound', 'a4-escaped']));
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

  it('refuses an unbound or escaped OAuth state participant before protocol mutation', async () => {
    await expect(createOauthStateStoreAdapter().recordDpopJti('a4-unbound', new Date(Date.now() + 60_000)))
      .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    const escaped = await runCmIdentityWrite(async transaction => createOauthStateStoreAdapter({ transaction }));
    await expect(escaped.recordDpopJti('a4-escaped', new Date(Date.now() + 60_000)))
      .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    await runCmIdentityWrite(async transaction => {
      const port = createOauthStateStoreAdapter({ transaction });
      expect(await port.recordDpopJti('a4-unbound', new Date(Date.now() + 60_000))).toBe(true);
      expect(await port.recordDpopJti('a4-escaped', new Date(Date.now() + 60_000))).toBe(true);
    });
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
      const port = createConsentStoreAdapter({ transaction });
      expect(await port.getGrant(userId, clientId, tenantId)).toBeNull();
      await port.saveGrant(userId, clientId, ['write'], tenantId);
      expect(await port.getGrant(userId, clientId, tenantId))
        .toMatchObject({ scopes: ['write'], offlineGrantId: null, offlineScopes: [] });
    });
  });

  it('never falls back to a default tenant or writes through an unbound participant', async () => {
    await expect(createConsentStoreAdapter().saveGrant(userId, clientId, ['read'], tenantId))
      .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    // Tenant-less grants are unkeyable by design (A4-LANE-R1R2): the save is a
    // no-op resolving undefined — no default tenant is substituted and the
    // empty protocol/authority below proves nothing was conferred.
    await expect(runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .saveGrant(userId, clientId, ['read']))).resolves.toBeUndefined();
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

  it('derives the token claim from CM and revalidates tenant activity', async () => {
    const list = () => runCmIdentityWrite(transaction => createCmOAuthTenantPort(transaction)
      .listApprovedTenantIds(userId));
    expect(await list()).toContain(tenantId);
    await setCmTenantStatus(tenantId, 'suspended');
    expect(await list()).not.toContain(tenantId);
    expect(await runCmIdentityWrite(transaction => createCmOAuthTenantPort(transaction)
      .isApprovedMember(userId, tenantId))).toBe(false);
  });

  it('revokes CM authority and protocol evidence atomically and refuses a restored evidence row', async () => {
    await runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .saveGrant(userId, clientId, ['read'], tenantId));
    const before = await protocol();
    expect(await revokeCmOAuthConsent({ userId, clientId, tenantId })).toBe(true);
    expect(await protocol()).toEqual([]);
    expect((await authority())[0].revoked_at).toBeTruthy();
    await db.insert(oauthConsents).values(before);
    expect(await runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .getGrant(userId, clientId, tenantId))).toBeNull();
  });

  it('rolls back both consent planes when revocation fails before commit', async () => {
    await runCmIdentityWrite(transaction => createConsentStoreAdapter({ transaction })
      .saveGrant(userId, clientId, ['read'], tenantId));
    const before = { authority: await authority(), protocol: await protocol() };
    await expect(runCmIdentityWrite(async () => {
      await revokeCmOAuthConsent({ userId, clientId, tenantId });
      throw new Error('injected_after_revocation');
    })).rejects.toThrow('injected_after_revocation');
    expect({ authority: await authority(), protocol: await protocol() }).toEqual(before);
  });
});
