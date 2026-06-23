// BR-39m A0-bis — SCREEN-DRIVEN SSO smoke for the standalone IdP.
//
// Proves the IdP serves its OWN login/consent screens AT ITS OWN ORIGIN and that
// the OAuth authorization_code flow can be completed by driving those served
// screens in a real (headless Chromium) browser — not by calling the bare API.
//
// Deterministic, no WebAuthn / maildev: a verified user + session token are
// pre-seeded by `screen-smoke-seed.ts` (api image) and injected as the IdP
// `session` cookie here. The browser then:
//   1. navigates GET /authorize -> asserts the IdP REDIRECTED to its OWN served
//      /auth/login screen and that the @sentropic/auth-ui login component mounted;
//   2. with the seeded session cookie, re-enters /authorize via the `continue`
//      param -> lands on the IdP-served /auth/oauth/consent screen;
//   3. clicks the real "Approve" button rendered by the served consent screen;
//   4. captures the authorization code on the redirect_uri;
//   5. exchanges the code for tokens and verifies id_token iss/aud/nonce/sub.
//
// Run (inside the e2e/playwright image, reaching the live IdP):
//   IDP_BASE_URL=http://auth-idp:8787 USER_ID=... SESSION_TOKEN=... \
//     npx tsx apps/auth-idp/screen-smoke.ts

import { createHash } from 'node:crypto';

import { chromium } from 'playwright';

const IDP_BASE_URL = (process.env.IDP_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const USER_ID = process.env.USER_ID ?? '';
const SESSION_TOKEN = process.env.SESSION_TOKEN ?? '';
const TEST_EMAIL = process.env.SCREEN_SMOKE_EMAIL ?? 'idp-screen-smoke@example.com';

const CLIENT_ID = 'design-system';
const CLIENT_SECRET = 'design-system-secret-dev-only';
// The RP redirect_uri must be a registered design-system redirect; we only need
// its origin to be reachable enough to read the `code` query param off the 302
// target — Playwright captures the navigation URL, the page itself is irrelevant.
const REDIRECT_URI = process.env.SCREEN_SMOKE_REDIRECT_URI ?? 'http://localhost:5399/auth/oauth/callback';
const CODE_VERIFIER = 'idp-screen-smoke-code-verifier-with-enough-entropy-0123456789';
const NONCE = 'idp-screen-smoke-nonce';
const STATE = 'idp-screen-smoke-state';

const fail = (msg: string): never => {
  console.error(`SCREEN-SMOKE FAIL: ${msg}`);
  process.exit(1);
};

const codeChallenge = createHash('sha256').update(CODE_VERIFIER).digest('base64url');

const buildAuthorizeUrl = (): string => {
  const u = new URL('/api/v1/auth/oauth/authorize', IDP_BASE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', STATE);
  u.searchParams.set('nonce', NONCE);
  return u.toString();
};

const main = async (): Promise<void> => {
  if (!USER_ID || !SESSION_TOKEN) fail('USER_ID and SESSION_TOKEN must be provided by the seed step');

  // 0. Discovery (the IdP advertises its own issuer; used for id_token iss check).
  const discoveryRes = await fetch(new URL('/.well-known/openid-configuration', IDP_BASE_URL));
  if (!discoveryRes.ok) fail(`discovery failed ${discoveryRes.status}`);
  const discovery = (await discoveryRes.json()) as { issuer?: string };
  const expectedIssuer = discovery.issuer ?? IDP_BASE_URL;
  console.log(`SCREEN-SMOKE: discovery OK, issuer=${expectedIssuer}`);

  // The IdP ships a prod-oriented CSP (`upgrade-insecure-requests`) + HSTS. Over
  // a plain-HTTP test origin that forces subresource requests to HTTPS and
  // breaks the /_app assets. Tell Chromium to treat the HTTP IdP origin as a
  // secure context (same `--unsafely-treat-insecure-origin-as-secure` pattern
  // the product e2e suite uses) so the prod security headers stay UNCHANGED.
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--unsafely-treat-insecure-origin-as-secure=${IDP_BASE_URL}`,
      '--allow-insecure-localhost',
    ],
  });
  try {
    const context = await browser.newContext({ baseURL: IDP_BASE_URL });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`  [browser console.error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error(`  [browser pageerror] ${err.message}`));
    page.on('requestfailed', (req) =>
      console.error(`  [browser requestfailed] ${req.url()} :: ${req.failure()?.errorText ?? ''}`),
    );

    // 1. Unauthenticated authorize -> the IdP must redirect to its OWN served
    //    login screen, and the @sentropic/auth-ui login component must mount.
    await page.goto(buildAuthorizeUrl(), { waitUntil: 'networkidle' });
    const afterAuthorize = new URL(page.url());
    if (afterAuthorize.origin !== new URL(IDP_BASE_URL).origin) {
      fail(`login screen not served at the IdP origin: ${page.url()}`);
    }
    if (!afterAuthorize.pathname.startsWith('/auth/login')) {
      fail(`authorize did not land on the served /auth/login screen: ${page.url()}`);
    }
    const continuation = afterAuthorize.searchParams.get('continue');
    if (!continuation) fail(`served login screen missing the OAuth continuation: ${page.url()}`);
    await page
      .getByRole('heading', { name: /connexion|sign in/i })
      .waitFor({ state: 'visible', timeout: 5000 });
    console.log('SCREEN-SMOKE: /authorize -> served /auth/login screen mounted (auth-ui) OK');

    // 2. Inject the seeded IdP session cookie (deterministic stand-in for a real
    //    passkey login), then resume authorize via the served screen's `continue`.
    await context.addCookies([
      {
        name: 'session',
        value: SESSION_TOKEN,
        url: IDP_BASE_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    // 3. Re-enter authorize with the continuation -> lands on the served consent
    //    screen. The consent approval will navigate the browser to the RP
    //    redirect_uri (an origin we don't host); intercept that request to
    //    capture the authorization code WITHOUT depending on the RP being up.
    const redirectBase = REDIRECT_URI.split('?')[0]!;
    let codeUrl: string | null = null;
    await context.route(`${redirectBase}*`, async (route) => {
      codeUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'captured' });
    });
    // BR-39r: the native-form consent navigates the RP via a real top-level 302 (not the old
    // window.location.assign). context.route does not reliably intercept that redirect-follow, but
    // the request event fires with the code-bearing URL (even when the unhosted RP then refuses the
    // connection). Capture it here so the smoke proves the server-302 carried the code.
    context.on('request', (req) => {
      const url = req.url();
      if (!codeUrl && url.startsWith(redirectBase)) codeUrl = url;
    });

    const resumeUrl = new URL('/api/v1/auth/oauth/authorize', IDP_BASE_URL);
    resumeUrl.searchParams.set('continue', continuation);
    await page.goto(resumeUrl.toString(), { waitUntil: 'networkidle' });

    const afterResume = new URL(page.url());
    if (!afterResume.pathname.startsWith('/auth/oauth/consent')) {
      fail(`authorize-with-session did not land on the served /auth/oauth/consent screen: ${page.url()}`);
    }
    // The served consent screen renders the real auth-ui consent UI + Approve btn.
    // Role-based selectors (not stale CSS classes): the DS-native conversion replaced the old
    // `.auth-ui-*` classes, and BR-39r makes the actions a native <form> with submit Buttons.
    const approveButton = page.getByRole('button', { name: /autoriser|approve/i });
    await approveButton.waitFor({ state: 'visible', timeout: 5000 });
    console.log('SCREEN-SMOKE: resume -> served /auth/oauth/consent screen mounted (auth-ui) OK');

    // 4. Click the real Approve button -> the screen submits the decision and
    //    navigates the browser to the redirect_uri with the authorization code,
    //    which our route interceptor captures.
    await approveButton.click();
    await page.waitForFunction(() => true, { timeout: 1000 }).catch(() => undefined);
    for (let i = 0; i < 80 && !codeUrl; i += 1) {
      await page.waitForTimeout(100);
    }
    if (!codeUrl) fail('Approve did not navigate to the redirect_uri with a code within timeout');
    const code = new URL(codeUrl).searchParams.get('code');
    const returnedState = new URL(codeUrl).searchParams.get('state');
    if (!code) fail(`no authorization code on the redirect_uri after Approve: ${codeUrl}`);
    if (returnedState !== STATE) fail(`state mismatch on redirect: ${returnedState} != ${STATE}`);
    console.log('SCREEN-SMOKE: clicked Approve on the served screen -> authorization code OK');

    // 5. Exchange the code for tokens and verify the id_token binds to our user.
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
    if (claims.nonce !== NONCE) fail(`id_token nonce mismatch: ${String(claims.nonce)}`);
    if (claims.sub !== USER_ID) fail(`id_token sub ${String(claims.sub)} != ${USER_ID}`);
    console.log('SCREEN-SMOKE: /token -> id_token (iss/aud/nonce/sub verified) OK');

    // 6. userinfo cross-check (Bearer) — identity claims match the seeded user.
    const userInfoRes = await fetch(new URL('/api/v1/auth/oauth/userinfo', IDP_BASE_URL), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoRes.ok) fail(`/userinfo failed ${userInfoRes.status}: ${await userInfoRes.text()}`);
    const userInfo = (await userInfoRes.json()) as Record<string, unknown>;
    if (userInfo.sub !== USER_ID) fail(`userinfo sub ${String(userInfo.sub)} != ${USER_ID}`);
    if (userInfo.email !== TEST_EMAIL) fail(`userinfo email ${String(userInfo.email)} != ${TEST_EMAIL}`);
    console.log('SCREEN-SMOKE: /userinfo -> sub/email verified OK');

    console.log(
      'SCREEN-SMOKE PASS: design-system authorization_code completed via the IdP-SERVED login + consent screens',
    );
  } finally {
    await browser.close();
  }
  process.exit(0);
};

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
