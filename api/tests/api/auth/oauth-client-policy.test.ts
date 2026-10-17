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
import { createSession } from '../../../src/services/session-manager';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const CLIENT_ID = 'example-policy-rp';
const REDIRECT_URI = 'http://localhost:5397/auth/oauth/callback';
const PASSKEY_ACR = 'urn:sentropic:loa:passkey-fresh';

describe('OAuth authorize per-client policy API (B3+C1)', () => {
  beforeEach(async () => {
    await seedPolicyClient({ requiredAcr: PASSKEY_ACR });
  });

  afterEach(async () => {
    await cleanupOAuthData();
    await cleanupAuthData();
  });

  it('forces login for a bearer session on a required_acr client', async () => {
    const user = await createTestUser({
      displayName: 'Bearer User',
      email: 'policy-bearer@example.com',
      role: 'editor',
      withSession: true,
    });

    const res = await app.request(buildAuthorizeUrl(), {
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('http://localhost:5397/auth/login');
  });

  it('passes an MFA session on a required_acr client through to consent', async () => {
    const user = await createTestUser({
      displayName: 'MFA User',
      email: 'policy-mfa@example.com',
      role: 'editor',
    });
    const session = await createSession(user.id, user.role, undefined, { mfaVerified: true });

    const res = await app.request(buildAuthorizeUrl(), {
      headers: { Cookie: `session=${session.sessionToken}` },
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('http://localhost:5397/auth/oauth/consent');
  });

  it('refuses a non-allowlisted subject with access_denied before consent', async () => {
    await seedPolicyClient({ allowedUserIds: ['owner-sub-1'], requiredAcr: null });
    const user = await createTestUser({
      displayName: 'Stranger',
      email: 'policy-stranger@example.com',
      role: 'editor',
      withSession: true,
    });

    const res = await app.request(buildAuthorizeUrl(), {
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('passes an allowlisted subject through to consent', async () => {
    const user = await createTestUser({
      displayName: 'Owner',
      email: 'policy-owner@example.com',
      role: 'editor',
      withSession: true,
    });
    await seedPolicyClient({ allowedUserIds: [user.id], requiredAcr: null });

    const res = await app.request(buildAuthorizeUrl(), {
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('http://localhost:5397/auth/oauth/consent');
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
  url.searchParams.set('state', 'rp-state-policy');
  url.searchParams.set('nonce', 'nonce-policy');
  return url.toString();
};

const seedPolicyClient = async (policy: { requiredAcr: string | null; allowedUserIds?: string[] }): Promise<void> => {
  const now = new Date();
  await db.insert(oauthClients).values({
    allowedScopes: ['openid', 'profile', 'email'],
    allowedUserIds: policy.allowedUserIds ?? [],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update('example-policy-rp-secret').digest('hex'),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: 'test-oauth-policy-client',
    name: 'Example Policy RP',
    redirectUris: [REDIRECT_URI],
    requirePkce: true,
    requiredAcr: policy.requiredAcr,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    updatedAt: now,
  }).onConflictDoUpdate({
    set: {
      allowedScopes: ['openid', 'profile', 'email'],
      allowedUserIds: policy.allowedUserIds ?? [],
      requiredAcr: policy.requiredAcr,
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
