// BR-39m Phase A0 — Standalone IdP SSO smoke (deterministic, headless).
//
// Drives a full OAuth2/OIDC authorization_code round-trip for the `design-system`
// client against the LIVE standalone IdP, reusing the SHARED DB to mint a
// verified test user + session (no UI, no WebAuthn, no maildev). Steps:
//   1. seed a verified test user + an app-owned session token in the shared DB;
//   2. GET /authorize with the session cookie -> consent redirect (sealed state);
//   3. POST /consent/decision {approve} -> authorization code on the redirect_uri;
//   4. POST /token (Basic client auth + PKCE verifier) -> id_token + access_token;
//   5. GET /userinfo (Bearer) -> verify sub/email match the seeded user.
//
// Run inside the api workspace (has DB client + reaches the IdP service):
//   IDP_BASE_URL=http://auth-idp:8787 tsx apps/auth-idp/sso-smoke.ts
//
// Exit code 0 on success, 1 on any failed assertion. This is a SMOKE, not a unit
// test: it asserts the composed IdP serves the end-to-end protocol on the shared DB.

import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../../api/src/db/client';
import { users } from '../../api/src/db/schema';
import { createSession } from '../../api/src/services/session-manager';

const IDP_BASE_URL = process.env.IDP_BASE_URL ?? 'http://localhost:8787';
const CLIENT_ID = 'design-system';
const CLIENT_SECRET = 'design-system-secret-dev-only';
const REDIRECT_URI = 'http://localhost:5399/auth/oauth/callback';
const CODE_VERIFIER = 'idp-smoke-code-verifier-with-enough-entropy-0123456789';
const TEST_EMAIL = 'idp-smoke@example.com';
const TEST_NAME = 'IdP Smoke User';

const fail = (msg: string): never => {
  console.error(`SSO-SMOKE FAIL: ${msg}`);
  process.exit(1);
};

const codeChallenge = createHash('sha256').update(CODE_VERIFIER).digest('base64url');

const seedUserAndSession = async (): Promise<{ userId: string; sessionToken: string }> => {
  const now = new Date();
  const userId = `idp-smoke-${randomUUID()}`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: TEST_EMAIL,
      displayName: TEST_NAME,
      role: 'editor',
      accountStatus: 'active',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { accountStatus: 'active', displayName: TEST_NAME, emailVerified: true, updatedAt: now },
      target: users.email,
    });

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (!row) fail('seeded user not found after upsert');
  const session = await createSession(row!.id, 'editor', { name: 'idp-smoke' });
  return { userId: row!.id, sessionToken: session.sessionToken };
};

const main = async (): Promise<void> => {
  const { userId, sessionToken } = await seedUserAndSession();
  console.log(`SSO-SMOKE: seeded user ${userId} + session against shared DB`);

  // 0. Discovery: the IdP advertises its own issuer (OAUTH_ISSUER_URL or derived);
  // use it for the id_token iss assertion so the smoke is host-independent.
  const discoveryRes = await fetch(new URL('/.well-known/openid-configuration', IDP_BASE_URL));
  if (!discoveryRes.ok) fail(`discovery failed ${discoveryRes.status}`);
  const discovery = (await discoveryRes.json()) as { issuer?: string };
  const expectedIssuer = discovery.issuer ?? IDP_BASE_URL;
  console.log(`SSO-SMOKE: discovery OK, issuer=${expectedIssuer}`);

  // 1. /authorize (with session cookie) -> consent redirect carrying sealed state.
  const authorizeUrl = new URL('/api/v1/auth/oauth/authorize', IDP_BASE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', 'idp-smoke-state');
  authorizeUrl.searchParams.set('nonce', 'idp-smoke-nonce');

  const authorizeRes = await fetch(authorizeUrl, {
    headers: { cookie: `session=${sessionToken}` },
    redirect: 'manual',
  });
  if (authorizeRes.status !== 302 && authorizeRes.status !== 303) {
    fail(`/authorize expected redirect, got ${authorizeRes.status}: ${await authorizeRes.text()}`);
  }
  const consentLocation = authorizeRes.headers.get('location') ?? '';
  const consentState = new URL(consentLocation, IDP_BASE_URL).searchParams.get('state');
  if (!consentState) fail(`/authorize redirect missing consent state: ${consentLocation}`);
  console.log('SSO-SMOKE: /authorize -> consent redirect OK');

  // 2. /consent/decision {approve} -> authorization code on the redirect_uri.
  const decisionRes = await fetch(new URL('/api/v1/auth/oauth/consent/decision', IDP_BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `session=${sessionToken}` },
    body: JSON.stringify({ decision: 'approve', state: consentState }),
    redirect: 'manual',
  });
  let code: string | null = null;
  if (decisionRes.status === 302 || decisionRes.status === 303) {
    code = new URL(decisionRes.headers.get('location') ?? '', IDP_BASE_URL).searchParams.get('code');
  } else if (decisionRes.ok) {
    const body = (await decisionRes.json()) as { redirectUri?: string; location?: string };
    const loc = body.location ?? body.redirectUri ?? '';
    code = new URL(loc, IDP_BASE_URL).searchParams.get('code');
  } else {
    fail(`/consent/decision failed ${decisionRes.status}: ${await decisionRes.text()}`);
  }
  if (!code) fail('no authorization code returned from consent decision');
  console.log('SSO-SMOKE: /consent/decision approve -> authorization code OK');

  // 3. /token (Basic client auth + PKCE verifier) -> tokens.
  const tokenRes = await fetch(new URL('/api/v1/auth/oauth/token', IDP_BASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: CODE_VERIFIER,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    }),
  });
  if (!tokenRes.ok) fail(`/token exchange failed ${tokenRes.status}: ${await tokenRes.text()}`);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    id_token?: string;
    token_type: string;
    scope?: string;
  };
  if (tokens.token_type !== 'Bearer') fail(`unexpected token_type ${tokens.token_type}`);
  if (!tokens.id_token) fail('missing id_token');
  if (tokens.scope !== 'openid profile email') fail(`unexpected scope ${tokens.scope}`);

  const claims = JSON.parse(
    Buffer.from(tokens.id_token!.split('.')[1]!, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  if (claims.iss !== expectedIssuer) fail(`id_token iss ${String(claims.iss)} != ${expectedIssuer}`);
  if (claims.aud !== CLIENT_ID) fail(`id_token aud ${String(claims.aud)} != ${CLIENT_ID}`);
  if (claims.nonce !== 'idp-smoke-nonce') fail(`id_token nonce mismatch: ${String(claims.nonce)}`);
  if (claims.sub !== userId) fail(`id_token sub ${String(claims.sub)} != ${userId}`);
  console.log('SSO-SMOKE: /token -> id_token + access_token (iss/aud/nonce/sub verified) OK');

  // 4. /userinfo (Bearer) -> verify identity claims.
  const userInfoRes = await fetch(new URL('/api/v1/auth/oauth/userinfo', IDP_BASE_URL), {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) fail(`/userinfo failed ${userInfoRes.status}: ${await userInfoRes.text()}`);
  const userInfo = (await userInfoRes.json()) as Record<string, unknown>;
  if (userInfo.sub !== userId) fail(`userinfo sub ${String(userInfo.sub)} != ${userId}`);
  if (userInfo.email !== TEST_EMAIL) fail(`userinfo email ${String(userInfo.email)} != ${TEST_EMAIL}`);
  console.log('SSO-SMOKE: /userinfo -> sub/email verified OK');

  console.log('SSO-SMOKE PASS: design-system authorization_code round-trip against the standalone IdP');
  process.exit(0);
};

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
