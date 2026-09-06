import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthTokens,
  revokedTokens,
} from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const CLIENT_ID = 'example-mock-rp-token';
const CLIENT_SECRET = 'example-mock-rp-secret-dev-only';
const REDIRECT_URI = 'http://localhost:5397/auth/oauth/callback';
const CODE_VERIFIER = 'test-code-verifier-with-enough-entropy-1234567890';

describe('OAuth token API route', () => {
  beforeEach(async () => {
    await seedOauthClient();
    await ensureActiveSigningKey('test-token-kid');
  });

  afterEach(async () => {
    await cleanupOAuthData();
    await cleanupAuthData();
  });

  it('exchanges an approved authorization code for access and id tokens', async () => {
    const { code } = await issueAuthorizationCode();

    const res = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: new URLSearchParams({
        code,
        code_verifier: CODE_VERIFIER,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }).toString(),
      headers: {
        Authorization: basicClientAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toMatchObject({
      expires_in: 3600,
      scope: 'openid profile email',
      token_type: 'Bearer',
    });
    expect(typeof payload.access_token).toBe('string');
    expect(typeof payload.id_token).toBe('string');

    const reuse = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: new URLSearchParams({
        code,
        code_verifier: CODE_VERIFIER,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }).toString(),
      headers: {
        Authorization: basicClientAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    expect(reuse.status).toBe(400);
    await expect(reuse.json()).resolves.toMatchObject({
      error: { code: 'invalid_grant' },
    });
  });
});

const issueAuthorizationCode = async (): Promise<{ code: string }> => {
  const user = await createTestUser({
    displayName: 'OAuth Token User',
    email: 'oauth-token-user@example.com',
    role: 'editor',
    withSession: true,
  });

  const authorize = await app.request(buildAuthorizeUrl(), {
    headers: { Cookie: `session=${user.sessionToken}` },
  });
  const consentLocation = new URL(authorize.headers.get('location') ?? '');
  const sealedState = consentLocation.searchParams.get('state') ?? '';

  const decision = await app.request('http://localhost:9197/api/v1/oauth/consent/decision', {
    body: JSON.stringify({ decision: 'approve', state: sealedState }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `session=${user.sessionToken}`,
    },
    method: 'POST',
  });

  expect(decision.status).toBe(200);
  const { redirectTo } = await decision.json();
  const callback = new URL(redirectTo);
  const code = callback.searchParams.get('code');
  expect(code).toBeTruthy();
  expect(callback.searchParams.get('state')).toBe('rp-state-1');
  return { code: code ?? '' };
};

const buildAuthorizeUrl = (): string => {
  const url = new URL('http://localhost:9197/api/v1/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', createHash('sha256').update(CODE_VERIFIER).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'rp-state-1');
  url.searchParams.set('nonce', 'nonce-1');
  return url.toString();
};

const basicClientAuth = (): string =>
  `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`;

const seedOauthClient = async (): Promise<void> => {
  const now = new Date();
  const values = {
    allowedScopes: ['openid', 'profile', 'email'],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update(CLIENT_SECRET).digest('hex'),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: 'test-oauth-token-client',
    name: 'Example Mock RP',
    redirectUris: [REDIRECT_URI],
    requirePkce: true,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    updatedAt: now,
  };
  await db.insert(oauthClients).values(values).onConflictDoUpdate({
    set: {
      allowedScopes: values.allowedScopes,
      clientSecretHash: values.clientSecretHash,
      redirectUris: values.redirectUris,
      updatedAt: now,
    },
    target: oauthClients.clientId,
  });
};

const cleanupOAuthData = async (): Promise<void> => {
  await db.delete(authorizationCodes).where(eq(authorizationCodes.clientId, CLIENT_ID));
  await db.delete(oauthTokens).where(eq(oauthTokens.clientId, CLIENT_ID));
  await db.delete(revokedTokens).where(eq(revokedTokens.clientId, CLIENT_ID));
  await db.delete(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
};

const ensureActiveSigningKey = async (kid: string): Promise<void> => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return;
  try {
    await jwks.generateAndStoreNewKey({ kid });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
};
