import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents, users } from '../../../src/db/schema';
import { createOAuthRefreshAdapter } from '../../../src/services/auth/oauth-refresh-adapter';
import { createConsentStoreAdapter } from '../../../src/services/auth/consent-store-adapter';

const now = new Date('2026-11-01T00:00:00Z');
const userId = 'refresh-pg-user';
const clientId = 'refresh-pg-client';
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const row = (id = 'family') => ({
  id, familyId: id, parentId: null, generation: 0, replacedById: null,
  tokenHash: hash(id), clientId, userId, tenantId: null, scope: 'immo:search offline_access',
  issuer: 'https://idp.test', audience: 'https://immo.test/mcp', resource: 'https://immo.test/mcp',
  offlineGrantId: 'epoch', dpopJkt: null, acr: 'urn:sentropic:loa:bearer', amr: ['pwd'],
  authTime: now, sessionId: null, createdAt: now,
  expiresAt: new Date(+now + 1296000000), familyExpiresAt: new Date(+now + 1296000000),
  consumedAt: null, revokedAt: null, revokedReason: null,
});
const adapter = () => createOAuthRefreshAdapter({ database: db });
const lock = { clientId, userId, familyId: 'family' };

describe('PostgreSQL refresh storage', () => {
  beforeEach(async () => {
    await db.insert(users).values({ id: userId, email: 'refresh-pg@example.test', emailVerified: true });
    await db.insert(oauthClients).values({
      id: clientId, clientId, name: 'Refresh PG', redirectUris: ['https://client.test/cb'],
      allowedScopes: ['immo:search', 'offline_access'], grantTypes: ['authorization_code', 'refresh_token'],
    });
    await adapter().save(row());
  });
  afterEach(async () => {
    await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('should persist only a digest and enforce a single active leaf', async () => {
    expect(await adapter().findByHash(hash('family'))).toMatchObject({ id: 'family', generation: 0 });
    await expect(adapter().save({ ...row('duplicate'), familyId: 'family', generation: 1 }))
      .rejects.toThrow();
  });

  it('should keep offline scope/resource approvals separate from online scope unions', async () => {
    const consents = createConsentStoreAdapter();
    await consents.saveGrant(userId, clientId, ['read', 'offline_access'], undefined,
      { issuer: 'https://idp.test', resource: 'https://a.test/mcp' });
    const first = await consents.getGrant(userId, clientId);
    await consents.saveGrant(userId, clientId, ['write', 'offline_access'], undefined,
      { issuer: 'https://idp.test', resource: 'https://b.test/mcp' });
    const second = await consents.getGrant(userId, clientId);
    expect(second?.scopes).toEqual(expect.arrayContaining(['read', 'write', 'offline_access']));
    expect(second?.offlineScopes).toEqual(['write', 'offline_access']);
    expect(second?.approvedResources).toEqual(['https://b.test/mcp']);
    expect(second?.offlineGrantId).not.toBe(first?.offlineGrantId);
    expect(await consents.getGrant(userId, clientId, 'other-tenant')).toBeNull();
  });

  it('should serialize racing rotations and retain replay evidence', async () => {
    const rotate = (childId: string) => adapter().withLock(lock, async (tx) => {
      const current = await tx.findByHash(hash('family'));
      if (current!.consumedAt) {
        await tx.revokeFamily('family', 'reuse_detected', now);
        return false;
      }
      await tx.consume('family', childId, now);
      await tx.save({ ...row(childId), familyId: 'family', parentId: 'family', generation: 1 });
      return true;
    });
    expect((await Promise.all([rotate('one'), rotate('two')])).filter(Boolean)).toHaveLength(1);
    expect(await adapter().findByHash(hash('family'))).toMatchObject({ revokedReason: 'reuse_detected' });
    const { rows } = await db.execute(sql`SELECT count(*)::int AS count FROM oauth_refresh_tokens
      WHERE family_id = 'family' AND consumed_at IS NULL AND revoked_at IS NULL`);
    expect(rows[0].count).toBe(0);
  });

  it('should roll back consumption and successor on signing or insert failure', async () => {
    await expect(adapter().withLock(lock, async (tx) => {
      await tx.consume('family', 'child', now);
      await tx.save({ ...row('child'), familyId: 'family', parentId: 'family', generation: 1 });
      throw new Error('signing failed');
    })).rejects.toThrow('signing failed');
    expect(await adapter().findByHash(hash('family'))).toMatchObject({ consumedAt: null });
    expect(await adapter().findByHash(hash('child'))).toBeNull();
  });

  it.each(['account', 'policy', 'consent'])('should invalidate %s removal without resurrection', async (kind) => {
    if (kind === 'account') {
      await db.update(users).set({ accountStatus: 'disabled_by_admin' }).where(eq(users.id, userId));
      await db.update(users).set({ accountStatus: 'active' }).where(eq(users.id, userId));
    } else if (kind === 'policy') {
      await db.update(oauthClients).set({ grantTypes: ['authorization_code'] }).where(eq(oauthClients.clientId, clientId));
      await db.update(oauthClients).set({ grantTypes: ['authorization_code', 'refresh_token'] }).where(eq(oauthClients.clientId, clientId));
    } else {
      await db.insert(oauthConsents).values({ userId, clientId, scopes: ['offline_access'] });
      await db.delete(oauthConsents).where(eq(oauthConsents.userId, userId));
    }
    expect((await adapter().findByHash(hash('family')))?.revokedAt).not.toBeNull();
  });
});
