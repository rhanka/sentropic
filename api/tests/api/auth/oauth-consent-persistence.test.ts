import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthConsents,
  oauthTokens,
  revokedTokens,
} from '../../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const CLIENT_ID = 'example-mock-rp-consent';
const REDIRECT_URI = 'http://localhost:5397/auth/oauth/callback';
const CODE_VERIFIER = 'test-code-verifier-with-enough-entropy-1234567890';

describe('OAuth consent persistence API route', () => {
  beforeEach(async () => {
    await seedOauthClient();
  });

  afterEach(async () => {
    await cleanupOAuthData();
    await cleanupAuthData();
  });

  it('persists a grant on approve, then skips consent on a covered re-authorize and re-shows on a new scope', async () => {
    const user = await createTestUser({
      displayName: 'OAuth Consent User',
      email: 'oauth-consent-user@example.com',
      role: 'editor',
      withSession: true,
    });
    const cookie = `session=${user.sessionToken}`;

    // 1) First authorize → consent screen (no stored grant yet).
    const firstAuthorize = await app.request(buildAuthorizeUrl('openid profile email'), {
      headers: { Cookie: cookie },
    });
    expect(firstAuthorize.status).toBe(302);
    const firstLocation = new URL(firstAuthorize.headers.get('location') ?? '');
    expect(`${firstLocation.origin}${firstLocation.pathname}`).toBe(
      'http://localhost:5397/auth/oauth/consent',
    );
    const sealedState = firstLocation.searchParams.get('state') ?? '';

    // 2) Approve → auth code issued AND grant row saved.
    const decision = await app.request('http://localhost:9197/api/v1/auth/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'approve', state: sealedState }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie },
      method: 'POST',
    });
    expect(decision.status).toBe(200);
    const { redirectTo } = await decision.json();
    expect(new URL(redirectTo).searchParams.get('code')).toBeTruthy();

    const grant = await readGrant(user.id);
    expect(grant).not.toBeNull();
    expect([...(grant?.scopes ?? [])].sort()).toEqual(['email', 'openid', 'profile']);

    // 3) Second authorize, same scopes ⇒ NO consent: 302 straight to redirect_uri with a code.
    const secondAuthorize = await app.request(buildAuthorizeUrl('openid profile email'), {
      headers: { Cookie: cookie },
    });
    expect(secondAuthorize.status).toBe(302);
    const secondLocation = new URL(secondAuthorize.headers.get('location') ?? '');
    expect(`${secondLocation.origin}${secondLocation.pathname}`).toBe(REDIRECT_URI);
    expect(secondLocation.searchParams.get('code')).toBeTruthy();
    expect(secondLocation.searchParams.get('state')).toBe('rp-state-1');

    // 4) Second authorize requesting a NEW (uncovered) scope ⇒ consent screen (scope escalation).
    const escalateAuthorize = await app.request(buildAuthorizeUrl('openid profile email offline'), {
      headers: { Cookie: cookie },
    });
    expect(escalateAuthorize.status).toBe(302);
    const escalateLocation = new URL(escalateAuthorize.headers.get('location') ?? '');
    expect(`${escalateLocation.origin}${escalateLocation.pathname}`).toBe(
      'http://localhost:5397/auth/oauth/consent',
    );
    expect(escalateLocation.searchParams.get('code')).toBeNull();
  });

  it('does not persist a grant when consent is denied', async () => {
    const user = await createTestUser({
      displayName: 'OAuth Deny User',
      email: 'oauth-deny-user@example.com',
      role: 'editor',
      withSession: true,
    });
    const cookie = `session=${user.sessionToken}`;

    const authorize = await app.request(buildAuthorizeUrl('openid profile email'), {
      headers: { Cookie: cookie },
    });
    const sealedState = new URL(authorize.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const decision = await app.request('http://localhost:9197/api/v1/auth/oauth/consent/decision', {
      body: JSON.stringify({ decision: 'deny', state: sealedState }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie },
      method: 'POST',
    });
    expect(decision.status).toBe(200);

    expect(await readGrant(user.id)).toBeNull();
  });
});

const buildAuthorizeUrl = (scope: string): string => {
  const url = new URL('http://localhost:9197/api/v1/auth/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', scope);
  url.searchParams.set('code_challenge', createHash('sha256').update(CODE_VERIFIER).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'rp-state-1');
  url.searchParams.set('nonce', 'nonce-1');
  return url.toString();
};

const readGrant = async (userId: string): Promise<{ scopes: string[] } | null> => {
  const [row] = await db
    .select({ scopes: oauthConsents.scopes })
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, CLIENT_ID)))
    .limit(1);
  return row ? { scopes: row.scopes } : null;
};

const seedOauthClient = async (): Promise<void> => {
  const now = new Date();
  const values = {
    allowedScopes: ['openid', 'profile', 'email', 'offline'],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update('example-mock-rp-secret-dev-only').digest('hex'),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: 'test-oauth-consent-client',
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
  await db.delete(oauthConsents).where(eq(oauthConsents.clientId, CLIENT_ID));
  await db.delete(authorizationCodes).where(eq(authorizationCodes.clientId, CLIENT_ID));
  await db.delete(oauthTokens).where(eq(oauthTokens.clientId, CLIENT_ID));
  await db.delete(revokedTokens).where(eq(revokedTokens.clientId, CLIENT_ID));
  await db.delete(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
};
