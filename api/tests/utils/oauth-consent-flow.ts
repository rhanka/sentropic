import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { app } from '../../src/app';
import { pool } from '../../src/db/client';
import { createJwksAdapter } from '../../src/services/auth/jwks-adapter';

export const CONSENT_FLOW_REDIRECT = 'https://client.test/callback';
export const CONSENT_FLOW_RESOURCE = 'https://immo.test/mcp';
const base = 'http://localhost:9197/api/v1/oauth';
const verifier = 'optional-tenant-consent-pkce-verifier-256-bits';

/** Authorization-code + PKCE + offline_access flow through the host app, for one session cookie. */
export const createConsentFlow = (cookie: () => string) => {
  const post = (clientId: string, endpoint: string, values: Record<string, string>) =>
    app.request(`${base}/${endpoint}`, {
      method: 'POST', body: new URLSearchParams({ client_id: clientId, ...values }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: cookie() },
    });
  const authorize = async (clientId: string) => new URL((await app.request(`${base}/authorize?${new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: CONSENT_FLOW_REDIRECT, scope: 'openid offline_access',
    resource: CONSENT_FLOW_RESOURCE, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  })}`, { headers: { Cookie: cookie() } })).headers.get('location')!);
  const approve = async (clientId: string) => {
    const consent = await authorize(clientId);
    expect(consent.searchParams.get('code')).toBeNull();
    return post(clientId, 'consent/decision', { decision: 'approve', state: consent.searchParams.get('state')! });
  };
  const exchange = async (clientId: string, code: string) => {
    const token = await post(clientId, 'token', { grant_type: 'authorization_code', code, code_verifier: verifier,
      redirect_uri: CONSENT_FLOW_REDIRECT });
    expect(token.status).toBe(200);
    return token.json() as Promise<{ access_token: string; refresh_token: string }>;
  };
  const issue = async (clientId: string) => {
    const approval = await approve(clientId);
    expect(approval.status).toBe(302);
    return exchange(clientId, new URL(approval.headers.get('location')!).searchParams.get('code')!);
  };
  const refresh = (clientId: string, token: string) =>
    post(clientId, 'token', { grant_type: 'refresh_token', refresh_token: token });
  return { authorize, approve, exchange, issue, refresh };
};

export const accessClaims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/** Generation-0 refresh family anchors of one (user, client), with their tenant and revocation. */
export const refreshFamilies = async (userId: string, clientId: string) => (await pool.query<{
  tenant_id: string | null; revoked_reason: string | null;
}>(`SELECT tenant_id, revoked_reason FROM oauth_refresh_tokens WHERE user_id = $1 AND client_id = $2
  AND generation = 0 ORDER BY created_at, id`, [userId, clientId])).rows;

/** Parallel test files may race to create the single active signing key: the loser reuses the winner's. */
export const ensureSigningKey = async (kid: string) => {
  const keys = createJwksAdapter();
  if (await keys.getActiveKey()) return;
  try { await keys.generateAndStoreNewKey({ kid }); }
  catch (error) {
    // The insert lost the race: another file committed the active key first. This instance negatively cached
    // the pre-race lookup, so poll with a fresh adapter until the winner's key becomes visible.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await createJwksAdapter().getActiveKey()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw error;
  }
};
