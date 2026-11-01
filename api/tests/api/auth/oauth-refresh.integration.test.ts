import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import { oauthClients, oauthConsents, users } from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const base = 'http://localhost:9197/api/v1/oauth';
const clientId = 'refresh-integration';
const verifier = 'refresh-integration-pkce-verifier-256-bits';
let cookie = '';
let userId = '';
const post = (endpoint: string, values: Record<string, string>) => app.request(`${base}/${endpoint}`, {
  method: 'POST', body: new URLSearchParams({ client_id: clientId, ...values }),
  headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: cookie },
});
const authorize = () => app.request(`${base}/authorize?${new URLSearchParams({
  client_id: clientId, response_type: 'code', redirect_uri: 'https://client.test/callback',
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  scope: 'openid offline_access', resource: 'https://immo.test/mcp',
})}`, { headers: { Cookie: cookie } });
const issue = async () => {
  const auth = await authorize();
  const location = new URL(auth.headers.get('location')!);
  let code = location.searchParams.get('code');
  if (!code) {
    const approval = await post('consent/decision', { decision: 'approve', state: location.searchParams.get('state')! });
    expect(approval.status).toBe(302);
    code = new URL(approval.headers.get('location')!).searchParams.get('code');
  }
  const response = await post('token', { grant_type: 'authorization_code', code: code!,
    code_verifier: verifier, redirect_uri: 'https://client.test/callback' });
  expect(response.status).toBe(200);
  return response.json();
};

describe('host OAuth refresh HTTP integration', () => {
  beforeEach(async () => {
    await db.insert(oauthClients).values({ id: clientId, clientId, name: 'Refresh integration',
      redirectUris: ['https://client.test/callback'], allowedScopes: ['openid', 'offline_access'],
      resourceIndicators: ['https://immo.test/mcp'], grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none', requirePkce: true });
    const user = await createTestUser({ withSession: true, withWorkspace: false, role: 'editor' });
    userId = user.id; cookie = `session=${user.sessionToken}`;
    const keys = createJwksAdapter();
    if (!await keys.getActiveKey()) await keys.generateAndStoreNewKey({ kid: 'refresh-integration-kid' });
  });
  afterEach(async () => {
    await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
    await cleanupAuthData();
  });

  it('should authorize, consent, rotate twice and revoke the entire family through a spent token', async () => {
    const initial = await issue();
    expect(initial.expires_in).toBe(3600);
    const secondResponse = await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token });
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    const thirdResponse = await post('token', { grant_type: 'refresh_token', refresh_token: second.refresh_token });
    expect(thirdResponse.status).toBe(200);
    const third = await thirdResponse.json();
    expect((await post('introspect', { token: third.refresh_token })).status).toBe(200);
    expect((await post('revoke', { token: initial.refresh_token })).status).toBe(200);
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: third.refresh_token })).status).toBe(400);
  });

  it.each(['account', 'consent', 'security'])('should invalidate %s authority without restoration revival', async (kind) => {
    const initial = await issue();
    if (kind === 'account') {
      await db.update(users).set({ accountStatus: 'disabled_by_admin' }).where(eq(users.id, userId));
      await db.update(users).set({ accountStatus: 'active' }).where(eq(users.id, userId));
    } else if (kind === 'consent') await db.delete(oauthConsents).where(eq(oauthConsents.userId, userId));
    else {
      const { deleteAndQueueRemoteSessions } = await import('../../../src/services/auth/remote-revocation-outbox');
      await deleteAndQueueRemoteSessions({ userId });
    }
    expect((await post('token', { grant_type: 'refresh_token', refresh_token: initial.refresh_token })).status).toBe(400);
  });
});
