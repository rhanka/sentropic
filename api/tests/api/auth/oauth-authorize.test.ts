import { createHash, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthTokens,
  revokedTokens,
} from '../../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { authenticateCmHttpRequest } from '../../../src/services/identity/cm-http-principal';
import { revokeAllCmSessionsForUser } from '../../../src/services/identity/cm-sessions';

const CLIENT_ID = 'example-mock-rp-authorize';
const REDIRECT_URI = 'http://localhost:5397/auth/oauth/callback';

describe('OAuth authorize API route', () => {
  beforeEach(async () => {
    await seedOauthClient();
  });

  afterEach(async () => {
    await cleanupOAuthData();
    await cleanupAuthData();
  });

  it('redirects unauthenticated authorization requests to the Sentropic login page', async () => {
    const res = await app.request(buildAuthorizeUrl());

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('http://localhost:5397/auth/login');
    expect(location.searchParams.get('continue')).toBeTruthy();
  });

  it('loads consent during concurrent same-session page authentication', async () => {
    const user = await createTestUser({ role: 'admin_app', withSession: true });
    const headers = { cookie: `session=${user.sessionToken}` };
    const authorize = await app.request(buildAuthorizeUrl(), { headers });
    expect(authorize.status).toBe(302);
    const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
    const [details, authentications] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, () => app.request(
        `/api/v1/oauth/consent?state=${encodeURIComponent(state)}`, { headers }))),
      Promise.all(Array.from({ length: 12 }, () => authenticateCmHttpRequest(
        new Request('http://cm.local/page', { headers }), true))),
    ]);
    expect(details.map(response => response.status)).toEqual(Array.from({ length: 12 }, () => 200));
    expect(authentications.every(result => result.accepted)).toBe(true);
  });

  it('loads valid consent even when a session activity write suffers a serialization conflict', async () => {
    const user = await createTestUser({ role: 'admin_app', withSession: true });
    const headers = { cookie: `session=${user.sessionToken}` };
    const authorize = await app.request(buildAuthorizeUrl(), { headers });
    expect(authorize.status).toBe(302);
    const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
    const fault = `a4_consent_${randomUUID().replaceAll('-', '')}`;
    const digest = createHash('sha256').update(user.sessionToken!).digest('hex');
    await db.run(sql.raw(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic_activity_conflict' USING ERRCODE = '40001'; END $$`));
    await db.run(sql.raw(`CREATE TRIGGER "${fault}" BEFORE UPDATE ON cm_identity.identity_login_token_bindings
      FOR EACH ROW WHEN (OLD.session_token_hash = '${digest}') EXECUTE FUNCTION public."${fault}"()`));
    try {
      const details = await app.request(`/api/v1/oauth/consent?state=${encodeURIComponent(state)}`, { headers });
      expect(details.status).toBe(200);
      expect(await details.json()).toMatchObject({ clientName: 'Example Mock RP', scopes: ['openid', 'profile', 'email'] });
      await revokeAllCmSessionsForUser(user.id);
      const refused = await app.request(`/api/v1/oauth/consent?state=${encodeURIComponent(state)}`, { headers });
      expect(refused.status).toBe(401);
    } finally {
      await db.run(sql.raw(`DROP TRIGGER "${fault}" ON cm_identity.identity_login_token_bindings`));
      await db.run(sql.raw(`DROP FUNCTION public."${fault}"()`));
    }
  });

  it('redirects authenticated authorization requests to consent and exposes consent details', async () => {
    const user = await createTestUser({
      displayName: 'OAuth User',
      email: 'oauth-user@example.com',
      role: 'editor',
      withSession: true,
    });

    const authorize = await app.request(buildAuthorizeUrl(), {
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(authorize.status).toBe(302);
    const consentLocation = new URL(authorize.headers.get('location') ?? '');
    expect(consentLocation.origin + consentLocation.pathname).toBe(
      'http://localhost:5397/auth/oauth/consent',
    );
    const sealedState = consentLocation.searchParams.get('state');
    expect(sealedState).toBeTruthy();

    const details = await app.request(
      `http://localhost:9197/api/v1/oauth/consent?state=${encodeURIComponent(sealedState ?? '')}`,
      {
        headers: { Cookie: `session=${user.sessionToken}` },
      },
    );

    expect(details.status).toBe(200);
    await expect(details.json()).resolves.toMatchObject({
      clientName: 'Example Mock RP',
      redirectUri: REDIRECT_URI,
      scopes: ['openid', 'profile', 'email'],
    });
  });
});

const buildAuthorizeUrl = (): string => {
  const url = new URL('http://localhost:9197/api/v1/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', 'test-code-challenge');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'rp-state-1');
  url.searchParams.set('nonce', 'nonce-1');
  return url.toString();
};

const seedOauthClient = async (): Promise<void> => {
  const now = new Date();
  await db.insert(oauthClients).values({
    allowedScopes: ['openid', 'profile', 'email'],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update('example-mock-rp-secret-dev-only').digest('hex'),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: 'test-oauth-client',
    name: 'Example Mock RP',
    redirectUris: [REDIRECT_URI, 'http://localhost:5173/auth/oauth/callback'],
    requirePkce: true,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    updatedAt: now,
  }).onConflictDoUpdate({
    set: {
      allowedScopes: ['openid', 'profile', 'email'],
      clientSecretHash: createHash('sha256').update('example-mock-rp-secret-dev-only').digest('hex'),
      redirectUris: [REDIRECT_URI, 'http://localhost:5173/auth/oauth/callback'],
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
