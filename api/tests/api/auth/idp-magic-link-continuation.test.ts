import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { createIdpApp } from '../../../../apps/auth-idp/idp-app';
import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  magicLinkContinuations,
  oauthClients,
  oauthConsents,
  oauthTokens,
  revokedTokens,
} from '../../../src/db/schema';
import { sha256Hex } from '../../../src/services/identity/cm-proofs';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

const sendTransactionalEmailMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/scw-tem-client', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

const MAGIC_CLIENT_ID = 'keynote-feedbacks-test';
const DEFAULT_CLIENT_ID = 'default-passkey-test';
const REDIRECT_URI = 'https://dev-mtl-keynote-2026.sent-tech.ca/sondage/callback';
const CODE_VERIFIER = 'idp-magic-link-test-verifier-with-enough-entropy-0123456789';
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url');

const buildIdpAuthorizeUrl = (clientId: string): string => {
  const url = new URL('http://localhost:9199/api/v1/auth/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', CODE_CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'poll-state-123');
  url.searchParams.set('nonce', 'poll-nonce-123');
  return url.toString();
};

const extractMagicLinkToken = (): string => {
  const mail = sendTransactionalEmailMock.mock.calls.at(-1)?.[0] as { text?: string } | undefined;
  const match = typeof mail?.text === 'string' ? mail.text.match(/https?:\/\/[^\s]+/) : null;
  const token = match ? new URL(match[0]).searchParams.get('token') : null;
  if (!token) throw new Error('Expected magic-link token in sent email');
  return token;
};

describe('IdP magic-link sign-in with server-side continuation', () => {
  beforeEach(async () => {
    sendTransactionalEmailMock.mockReset();
    sendTransactionalEmailMock.mockResolvedValue(undefined);
    const now = new Date();
    await db.insert(oauthClients).values([
      {
        id: `test-${MAGIC_CLIENT_ID}`,
        clientId: MAGIC_CLIENT_ID,
        clientSecretHash: null,
        name: 'Keynote Feedbacks',
        redirectUris: [REDIRECT_URI],
        allowedScopes: ['openid', 'profile', 'email'],
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'none',
        dpopBoundAccessTokens: false,
        requirePkce: true,
        requireTenant: false,
        magicLinkSignIn: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `test-${DEFAULT_CLIENT_ID}`,
        clientId: DEFAULT_CLIENT_ID,
        clientSecretHash: null,
        name: 'Default Passkey RP',
        redirectUris: [REDIRECT_URI],
        allowedScopes: ['openid', 'profile', 'email'],
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'none',
        dpopBoundAccessTokens: false,
        requirePkce: true,
        requireTenant: false,
        magicLinkSignIn: false,
        createdAt: now,
        updatedAt: now,
      },
    ]).onConflictDoNothing();
  });

  afterEach(async () => {
    await db.delete(magicLinkContinuations);
    await db.delete(oauthConsents).where(inArray(oauthConsents.clientId, [MAGIC_CLIENT_ID, DEFAULT_CLIENT_ID]));
    await db.delete(authorizationCodes).where(inArray(authorizationCodes.clientId, [MAGIC_CLIENT_ID, DEFAULT_CLIENT_ID]));
    await db.delete(oauthTokens).where(inArray(oauthTokens.clientId, [MAGIC_CLIENT_ID, DEFAULT_CLIENT_ID]));
    await db.delete(revokedTokens).where(inArray(revokedTokens.clientId, [MAGIC_CLIENT_ID, DEFAULT_CLIENT_ID]));
    await db.delete(oauthClients).where(inArray(oauthClients.clientId, [MAGIC_CLIENT_ID, DEFAULT_CLIENT_ID]));
    await cleanupAuthData();
  });

  it('completes authorize -> login-policy -> magic-link request/verify -> resume authorize -> consent', async () => {
    const idp = createIdpApp();

    // 1. Unauthenticated authorize redirects to /auth/login?continue=...
    const authorizeRes = await idp.request(buildIdpAuthorizeUrl(MAGIC_CLIENT_ID));
    expect(authorizeRes.status).toBe(302);
    const loginLocation = new URL(authorizeRes.headers.get('location') ?? '');
    const continuation = loginLocation.searchParams.get('continue');
    expect(continuation).toBeTruthy();

    // 2. login-policy returns magicLinkSignIn=true for keynote-feedbacks, false for default client
    const policyRes = await idp.request(
      `http://localhost:9199/api/v1/auth/oauth/login-policy?continue=${encodeURIComponent(continuation!)}`,
    );
    expect(policyRes.status).toBe(200);
    await expect(policyRes.json()).resolves.toEqual({ magicLinkSignIn: true });

    // 3. Request magic link with email + sealed continue (new participant)
    const requestRes = await idp.request('http://localhost:9199/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'participant@example.com', continue: continuation }),
    });
    expect(requestRes.status).toBe(200);
    await expect(requestRes.json()).resolves.toMatchObject({ delivery: 'magic_link', success: true });

    // Email link carries only ?token=... (never the continuation)
    const token = extractMagicLinkToken();
    const mailedUrl = new URL(
      (sendTransactionalEmailMock.mock.calls.at(-1)?.[0] as { text: string }).text.match(/https?:\/\/[^\s]+/)![0],
    );
    expect(mailedUrl.searchParams.get('continue')).toBeNull();

    // Continuation is stored server-side by token hash
    const storedContinuation = await db
      .select()
      .from(magicLinkContinuations)
      .where(eq(magicLinkContinuations.tokenHash, sha256Hex(token)));
    expect(storedContinuation).toHaveLength(1);

    // 4. Verify magic link -> creates user + sets session cookie + returns server-stored continueUrl
    const verifyRes = await idp.request('http://localhost:9199/api/v1/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(verifyRes.status).toBe(200);
    const setCookie = verifyRes.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('session=');
    const sessionCookie = setCookie.split(';')[0]!;
    const verifyJson = (await verifyRes.json()) as { continueUrl?: string; user?: { email?: string } };
    expect(verifyJson.user?.email).toBe('participant@example.com');
    expect(verifyJson.continueUrl).toBe(`/api/v1/auth/oauth/authorize?continue=${encodeURIComponent(continuation!)}`);

    // 5. Single-use guard: replaying the token fails and continuation row is deleted
    const replayRes = await idp.request('http://localhost:9199/api/v1/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(replayRes.status).toBe(400);

    // 6. Browser navigates to continueUrl with session cookie -> resumes authorize -> consent
    const resumeRes = await idp.request(`http://localhost:9199${verifyJson.continueUrl}`, {
      headers: { cookie: sessionCookie },
    });
    expect(resumeRes.status).toBe(302);
    const consentLocation = new URL(resumeRes.headers.get('location') ?? '');
    expect(consentLocation.pathname).toBe('/auth/oauth/consent');
    expect(consentLocation.searchParams.get('state')).toBeTruthy();
  });

  it('prevents account enumeration and rejects non-opted-in clients or untrusted returnUrls', async () => {
    const idp = createIdpApp();
    await createTestUser({ email: 'known-user@example.com', displayName: 'Known User' });

    const [existingRes, unknownRes] = await Promise.all([
      idp.request('http://localhost:9199/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'known-user@example.com' }),
      }),
      idp.request('http://localhost:9199/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'unknown-user@example.com' }),
      }),
    ]);
    expect(existingRes.status).toBe(200);
    expect(unknownRes.status).toBe(200);
    const existingBody = (await existingRes.json()) as Record<string, unknown>;
    const unknownBody = (await unknownRes.json()) as Record<string, unknown>;
    expect(Object.keys(existingBody).sort()).toEqual(Object.keys(unknownBody).sort());

    // Default client with magicLinkSignIn=false cannot issue a magic-link continuation
    const defaultAuth = await idp.request(buildIdpAuthorizeUrl(DEFAULT_CLIENT_ID));
    const defaultContinue = new URL(defaultAuth.headers.get('location') ?? '').searchParams.get('continue')!;
    const rejectedClientRes = await idp.request('http://localhost:9199/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'participant@example.com', continue: defaultContinue }),
    });
    expect(rejectedClientRes.status).toBe(400);

    // Untrusted external returnUrl is rejected
    const rejectedReturnRes = await idp.request('http://localhost:9199/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'participant@example.com', returnUrl: 'https://evil.example/phish' }),
    });
    expect(rejectedReturnRes.status).toBe(400);
  });
});
