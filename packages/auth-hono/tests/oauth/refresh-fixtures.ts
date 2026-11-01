import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthHonoConsentGrant, OAuthRefreshRecord, OAuthRefreshStorePort } from '../../src/index.js';
import { createOauthClient, createOauthPorts, createOauthRouterForTest, oauthNow } from '../__fixtures__/oauth-fixtures.js';
import { saveOAuthCode, tokenRequest } from '../__fixtures__/oauth-flow-fixtures.js';

export const refreshFixture = async () => {
  const client = createOauthClient({
    allowedScopes: ['openid', 'profile', 'offline_access'],
    grantTypes: ['authorization_code', 'refresh_token'], resourceIndicators: ['https://resource.test/mcp'],
  });
  const { ports, store } = await createOauthPorts({ clients: [client], authenticated: true });
  let now = oauthNow;
  ports.clock.now = () => now;
  ports.tokens.hashSecret = (raw) => createHash('sha256').update(raw).digest('hex');
  client.clientSecretHash = await ports.tokens.hashSecret('client-secret');
  ports.random.token = (bytes) => randomBytes(bytes).toString('base64url');
  ports.random.uuid = randomUUID;
  let grant: AuthHonoConsentGrant | null = {
    scopes: client.allowedScopes, offlineScopes: client.allowedScopes, offlineGrantId: 'epoch-1',
    offlineIssuer: 'http://localhost:9197', approvedResources: ['https://resource.test/mcp'],
    defaultAudienceApproved: true, offlineConsentedAt: oauthNow,
  };
  ports.consentStore = { getGrant: async () => grant, saveGrant: async () => undefined };
  const rows = new Map<string, OAuthRefreshRecord>();
  const refresh: OAuthRefreshStorePort = {
    findByHash: async (hash) => [...rows.values()].find((row) => row.tokenHash === hash) ?? null,
    findAnchor: async (id) => rows.get(id) ?? null,
    save: async (row) => { rows.set(row.id, { ...row }); },
    consume: async (id, childId, at) => {
      const row = rows.get(id)!;
      if (row.consumedAt || row.revokedAt) return false;
      row.consumedAt = at; row.replacedById = childId; return true;
    },
    revokeFamily: async (id, reason, at) => {
      for (const row of rows.values()) if (row.familyId === id) {
        row.revokedAt ??= at; row.revokedReason ??= reason;
      }
      for (const { meta } of store.tokens.values()) if (meta.refreshFamilyId === id) await store.revokeToken(meta.jti);
    },
    transaction: async (_lock, work) => work(ports),
  };
  ports.oauthRefresh = refresh;
  const { router } = createOauthRouterForTest({ ports });
  const issue = async () => {
    await saveOAuthCode(store, 'offline-code', {
      scope: 'openid profile offline_access', offlineGrantId: 'epoch-1', issuer: 'http://localhost:9197',
      audience: 'https://resource.test/mcp', resource: 'https://resource.test/mcp', amr: ['federated'],
    });
    return tokenRequest(router, { code: 'offline-code' });
  };
  return { client, ports, router, rows, store, issue,
    advance: (at: Date) => { now = at; }, withdraw: () => { grant = null; } };
};

export const renew = (fixture: Awaited<ReturnType<typeof refreshFixture>>, token: string,
  extra: Record<string, string> = {}) => tokenRequest(fixture.router,
    { grant_type: 'refresh_token', refresh_token: token, ...extra });
