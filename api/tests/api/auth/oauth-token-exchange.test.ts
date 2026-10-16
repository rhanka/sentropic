import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthTokens,
  serviceClients,
} from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const PUBLIC_CLIENT_ID = 'immo-mcp';
const WORKLOAD_CLIENT_ID = 'immo-mcp-workload';
const WORKLOAD_SECRET = 'immo-mcp-workload-secret-dev-only';
const MCP_AUDIENCE = 'https://immo.sent-tech.ca/mcp';
const RADAR_AUDIENCE = 'https://immo.sent-tech.ca';
const EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const CODE_VERIFIER = 'test-exchange-verifier-with-enough-entropy-1234567890';

describe('OAuth token exchange API route (2-IdP)', () => {
  beforeEach(async () => {
    await seedPublicClient();
    await seedWorkloadClient();
    await ensureActiveSigningKey('test-exchange-kid');
  });

  afterEach(async () => {
    await db.delete(serviceClients).where(eq(serviceClients.clientId, WORKLOAD_CLIENT_ID));
    await db.delete(authorizationCodes).where(eq(authorizationCodes.clientId, PUBLIC_CLIENT_ID));
    await db.delete(oauthTokens).where(eq(oauthTokens.clientId, PUBLIC_CLIENT_ID));
    await db.delete(oauthTokens).where(eq(oauthTokens.clientId, WORKLOAD_CLIENT_ID));
    await db.delete(oauthClients).where(eq(oauthClients.clientId, PUBLIC_CLIENT_ID));
    await cleanupAuthData();
  });

  it('exchanges a host-issued subject for a Radar-audience token with the mandatory act claim', async () => {
    const subject = await issueSubjectToken();

    const res = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: new URLSearchParams({
        audience: RADAR_AUDIENCE,
        grant_type: EXCHANGE_GRANT,
        scope: 'immo:search',
        subject_token: subject,
        subject_token_type: ACCESS_TOKEN_TYPE,
      }).toString(),
      headers: {
        Authorization: basicAuth(WORKLOAD_CLIENT_ID, WORKLOAD_SECRET),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.token_type).toBe('Bearer');
    expect(payload.issued_token_type).toBe(ACCESS_TOKEN_TYPE);
    expect(payload.scope).toBe('immo:search');
    expect(payload.expires_in).toBeLessThanOrEqual(300);
    expect(payload).not.toHaveProperty('refresh_token');
    expect(payload).not.toHaveProperty('id_token');
    const claims = decodeJwt(payload.access_token as string) as Record<string, unknown>;
    expect(claims).toMatchObject({
      act: { sub: WORKLOAD_CLIENT_ID },
      aud: RADAR_AUDIENCE,
      client_id: WORKLOAD_CLIENT_ID,
      scope: 'immo:search',
    });
    expect(typeof claims.sub).toBe('string');
  });

  it('rejects the public client and a wrong workload secret before any exchange', async () => {
    const subject = await issueSubjectToken();

    const asPublic = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: exchangeBody(subject),
      headers: {
        Authorization: basicAuth(PUBLIC_CLIENT_ID, 'not-a-secret'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(asPublic.status).toBe(401);
    await expect(asPublic.json()).resolves.toMatchObject({ error: { code: 'invalid_client' } });

    const wrongSecret = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: exchangeBody(subject),
      headers: {
        Authorization: basicAuth(WORKLOAD_CLIENT_ID, 'wrong-secret'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(wrongSecret.status).toBe(401);
    await expect(wrongSecret.json()).resolves.toMatchObject({ error: { code: 'invalid_client' } });
  });

  it('rejects a scope outside the workload policy', async () => {
    const subject = await issueSubjectToken();

    const res = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: new URLSearchParams({
        audience: RADAR_AUDIENCE,
        grant_type: EXCHANGE_GRANT,
        scope: 'admin:write',
        subject_token: subject,
        subject_token_type: ACCESS_TOKEN_TYPE,
      }).toString(),
      headers: {
        Authorization: basicAuth(WORKLOAD_CLIENT_ID, WORKLOAD_SECRET),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_scope' } });
  });

  it('refuses both grants on a corrupt workload policy (fail-closed)', async () => {
    const subject = await issueSubjectToken();
    await db
      .update(serviceClients)
      .set({ exchangePolicy: { enabled: true, actorSub: 'x' } })
      .where(eq(serviceClients.clientId, WORKLOAD_CLIENT_ID));

    const exchange = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: exchangeBody(subject),
      headers: {
        Authorization: basicAuth(WORKLOAD_CLIENT_ID, WORKLOAD_SECRET),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(exchange.status).toBe(400);
    await expect(exchange.json()).resolves.toMatchObject({ error: { code: 'unauthorized_client' } });

    const credentials = await app.request('http://localhost:9197/api/v1/oauth/token', {
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'immo:search' }).toString(),
      headers: {
        Authorization: basicAuth(WORKLOAD_CLIENT_ID, WORKLOAD_SECRET),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(credentials.status).toBe(400);
    await expect(credentials.json()).resolves.toMatchObject({ error: { code: 'unauthorized_client' } });
  });
});

const exchangeBody = (subject: string): string =>
  new URLSearchParams({
    audience: RADAR_AUDIENCE,
    grant_type: EXCHANGE_GRANT,
    scope: 'immo:search',
    subject_token: subject,
    subject_token_type: ACCESS_TOKEN_TYPE,
  }).toString();

const issueSubjectToken = async (): Promise<string> => {
  const user = await createTestUser({
    displayName: 'Exchange User',
    email: `exchange-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    role: 'editor',
    withSession: true,
  });

  const authorizeUrl = new URL('http://localhost:9197/api/v1/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', PUBLIC_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback');
  authorizeUrl.searchParams.set('scope', 'immo:read immo:search');
  authorizeUrl.searchParams.set('resource', MCP_AUDIENCE);
  authorizeUrl.searchParams.set('code_challenge', createHash('sha256').update(CODE_VERIFIER).digest('base64url'));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', 'exchange-state-1');

  const authorize = await app.request(authorizeUrl.toString(), {
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
  const code = new URL((await decision.json()).redirectTo).searchParams.get('code');
  expect(code).toBeTruthy();

  const token = await app.request('http://localhost:9197/api/v1/oauth/token', {
    body: new URLSearchParams({
      client_id: PUBLIC_CLIENT_ID,
      code: code ?? '',
      code_verifier: CODE_VERIFIER,
      grant_type: 'authorization_code',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  expect(token.status).toBe(200);
  const subject = ((await token.json()) as { access_token: string }).access_token;
  expect((decodeJwt(subject) as { aud: string }).aud).toBe(MCP_AUDIENCE);
  return subject;
};

const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

const seedPublicClient = async (): Promise<void> => {
  const now = new Date();
  await db
    .insert(oauthClients)
    .values({
      allowedScopes: ['immo:read', 'immo:search', 'immo:documents:read'],
      clientId: PUBLIC_CLIENT_ID,
      clientSecretHash: null,
      createdAt: now,
      dpopBoundAccessTokens: false,
      grantTypes: ['authorization_code'],
      id: 'test-immo-mcp-public',
      name: 'Immo MCP',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      requirePkce: true,
      resourceIndicators: [MCP_AUDIENCE],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      updatedAt: now,
    })
    .onConflictDoNothing();
};

const seedWorkloadClient = async (): Promise<void> => {
  const now = new Date();
  await db
    .insert(serviceClients)
    .values({
      allowedScopes: ['immo:search'],
      clientId: WORKLOAD_CLIENT_ID,
      clientSecretHash: createHash('sha256').update(WORKLOAD_SECRET).digest('hex'),
      createdAt: now,
      displayName: 'Immo MCP workload',
      dpopBoundAccessTokens: false,
      exchangePolicy: {
        actorSub: WORKLOAD_CLIENT_ID,
        allowClientCredentials: false,
        allowedScopes: ['immo:search'],
        allowedSubjectAudiences: [MCP_AUDIENCE],
        allowedSubjectClients: [PUBLIC_CLIENT_ID],
        allowedTargetAudiences: [RADAR_AUDIENCE],
        enabled: true,
        environment: null,
        maxTtlSeconds: 300,
      },
      id: 'test-immo-mcp-workload',
      resourceIndicators: [RADAR_AUDIENCE],
      revokedAt: null,
    })
    .onConflictDoUpdate({
      set: {
        clientSecretHash: createHash('sha256').update(WORKLOAD_SECRET).digest('hex'),
        exchangePolicy: {
          actorSub: WORKLOAD_CLIENT_ID,
          allowClientCredentials: false,
          allowedScopes: ['immo:search'],
          allowedSubjectAudiences: [MCP_AUDIENCE],
          allowedSubjectClients: [PUBLIC_CLIENT_ID],
          allowedTargetAudiences: [RADAR_AUDIENCE],
          enabled: true,
          environment: null,
          maxTtlSeconds: 300,
        },
        revokedAt: null,
      },
      target: serviceClients.clientId,
    });
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
