import { createHash, randomUUID } from 'node:crypto';

import { createJwksService } from '@sentropic/auth-hono';
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
import { createOauthStateStoreAdapter } from '../../../src/services/auth/oauth-state-adapter';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const CLIENT_ID = 'example-mock-rp-revoke';
const CLIENT_SECRET = 'example-mock-rp-secret-dev-only';
const ISSUER = 'http://localhost:9197';

describe('OAuth revoke and introspect API routes', () => {
  beforeEach(async () => {
    await seedOauthClient();
  });

  afterEach(async () => {
    await cleanupOAuthData();
    await cleanupAuthData();
  });

  it('introspects an active token and returns inactive after revocation', async () => {
    const { accessToken, user } = await issueStoredAccessToken();

    const active = await introspect(accessToken);
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toMatchObject({
      active: true,
      client_id: CLIENT_ID,
      scope: 'openid profile email',
      sub: user.id,
      token_type: 'access_token',
    });

    const revoke = await app.request(`${ISSUER}/api/v1/oauth/revoke`, {
      body: new URLSearchParams({ token: accessToken }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    expect(revoke.status).toBe(200);

    const revoked = await introspect(accessToken);
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({ active: false });
  });
});

const introspect = (token: string): Promise<Response> =>
  app.request(`${ISSUER}/api/v1/oauth/introspect`, {
    body: new URLSearchParams({ token }).toString(),
    headers: {
      Authorization: basicClientAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

const issueStoredAccessToken = async () => {
  const user = await createTestUser({
    displayName: 'OAuth Introspection User',
    email: 'oauth-introspection-user@example.com',
    role: 'editor',
  });
  const jwks = await ensureActiveSigningKey('test-introspect-kid');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600 * 1000);
  const jti = `test-introspect-${randomUUID()}`;
  const accessToken = await createJwksService({
    clock: {
      addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000),
      now: () => now,
    },
    jwksPort: jwks,
  }).signJwt(
    {
      acr: 'urn:sentropic:loa:bearer',
      auth_time: Math.floor(now.getTime() / 1000),
      client_id: CLIENT_ID,
      scope: 'openid profile email',
    },
    {
      audience: `${ISSUER}/api/v1/oauth/userinfo`,
      expiresAt,
      issuer: ISSUER,
      jti,
      subject: user.id,
      type: 'JWT',
    },
  );

  await createOauthStateStoreAdapter({ now: () => now }).saveTokenMeta(
    jti,
    {
      audience: `${ISSUER}/api/v1/oauth/userinfo`,
      clientId: CLIENT_ID,
      createdAt: now,
      dpopJkt: null,
      expiresAt,
      jti,
      scope: 'openid profile email',
      tenantId: null,
      tokenType: 'access_token',
      userId: user.id,
    },
    3600,
  );

  return { accessToken, user };
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
    id: 'test-oauth-revoke-client',
    name: 'Example Mock RP',
    redirectUris: ['http://localhost:5397/auth/oauth/callback'],
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

const ensureActiveSigningKey = async (kid: string) => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return jwks;
  try {
    await jwks.generateAndStoreNewKey({ kid });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
  return createJwksAdapter();
};
