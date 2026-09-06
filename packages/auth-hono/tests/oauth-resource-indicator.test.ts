import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  basicAuth,
  formBody,
  oauthRedirectUri,
  oauthVerifier,
  saveOAuthCode,
  tokenRequest,
} from './__fixtures__/oauth-flow-fixtures.js';
import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
  oauthUser,
} from './__fixtures__/oauth-fixtures.js';

// BR-39l Lot 2 — RFC 8707 `resource` → variable `aud` on the authorization_code flow.
// Ratified conditions C1-C9 (spec/SPEC_DECISION_39L_RESOURCE_AUD_RATIFICATION.md); fixtures T1-T9.

const userinfoAudience = 'http://localhost:9197/oauth/userinfo';
const mcpResource = 'https://mcp.example.com';

const resourceClient = createOauthClient({ resourceIndicators: [mcpResource] });

const tokenLeg = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: { code: string; resources?: string[] }
) => {
  const form = new URLSearchParams({
    client_id: 'example-rp',
    code: input.code,
    code_verifier: oauthVerifier,
    grant_type: 'authorization_code',
    redirect_uri: oauthRedirectUri,
  });
  for (const value of input.resources ?? []) form.append('resource', value);
  return router.request('/oauth/token', {
    body: form.toString(),
    headers: {
      authorization: basicAuth('example-rp', 'client-secret'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
};

describe('BR-39l Lot 2 — RFC 8707 resource indicator → variable aud', () => {
  // T1 — Golden no-`resource` token: byte-identical to auth-hono 0.5.0 (default-aud = userinfo).
  it('T1: no resource ⇒ aud = userinfo URL, claim set unchanged (0.5.0 regression)', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-no-resource', { nonce: 'nonce-1', scope: 'openid profile email' });

    const response = await tokenRequest(router, { code: 'code-no-resource' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; id_token: string; token_type: string; expires_in: number };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    const access = decodeJwt(body.access_token);
    expect(access).toMatchObject({
      aud: userinfoAudience,
      client_id: 'example-rp',
      scope: 'openid profile email',
      sub: oauthUser.id,
    });
    expect(access).not.toHaveProperty('resource');
    // id_token aud stays the client_id (resource never touches the id_token).
    expect(decodeJwt(body.id_token)).toMatchObject({ aud: 'example-rp', nonce: 'nonce-1', sub: oauthUser.id });
  });

  // T2 — Allowlisted resource sealed at authorize ⇒ aud = exactly that resource (single string).
  it('T2: sealed resource ⇒ aud = resource; tid/scope unchanged; id_token aud still client_id', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    ports.tenant = {
      listApprovedTenantIds: async () => ['acme'],
      isApprovedMember: async (_userId, tenantId) => tenantId === 'acme',
    };
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-resource', {
      resource: mcpResource,
      scope: 'openid profile email',
      tenantId: 'acme',
    });

    const response = await tokenLeg(router, { code: 'code-resource', resources: [mcpResource] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; id_token: string };
    const access = decodeJwt(body.access_token);
    expect(access.aud).toBe(mcpResource);
    expect(typeof access.aud).toBe('string'); // single-aud: never an array
    expect(access).toMatchObject({ tid: 'acme', scope: 'openid profile email', sub: oauthUser.id });
    expect(decodeJwt(body.id_token).aud).toBe('example-rp');
  });

  // T2b — Resource sealed at authorize, NOT re-sent on the token leg ⇒ aud still derives from the seal.
  it('T2b: sealed resource governs aud even when token leg omits resource', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-resource-omit', { resource: mcpResource, scope: 'profile' });

    const response = await tokenLeg(router, { code: 'code-resource-omit' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(decodeJwt(body.access_token).aud).toBe(mcpResource);
  });

  // T3 — Repeated `resource` at the token leg ⇒ invalid_target (no multi-audience tokens).
  it('T3: repeated resource on the token leg ⇒ invalid_target', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-multi', { resource: mcpResource, scope: 'profile' });

    const response = await tokenLeg(router, { code: 'code-multi', resources: [mcpResource, 'https://other.example.com'] });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_target' } });
  });

  // T3-authorize — Repeated `resource` at the authorize leg ⇒ invalid_target.
  it('T3 (authorize): repeated resource at authorize ⇒ invalid_target redirect', async () => {
    const { ports } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(
      `${authorizePath()}&resource=${encodeURIComponent(mcpResource)}&resource=${encodeURIComponent('https://other.example.com')}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('invalid_target');
  });

  // T4 — Resource not in the client allowlist (default-deny) ⇒ invalid_target at authorize.
  it('T4: resource outside the allowlist ⇒ invalid_target at authorize', async () => {
    const { ports } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });

    const denied = await router.request(`${authorizePath()}&resource=${encodeURIComponent('https://not-allowed.example.com')}`);
    expect(denied.status).toBe(302);
    expect(new URL(denied.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_target');

    // empty allowlist (default client) ⇒ any resource denied
    const { ports: emptyPorts } = await createOauthPorts({ authenticated: true });
    const { router: emptyRouter } = createOauthRouterForTest({ ports: emptyPorts });
    const emptyDenied = await emptyRouter.request(`${authorizePath()}&resource=${encodeURIComponent(mcpResource)}`);
    expect(new URL(emptyDenied.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_target');
  });

  // T5 — Token-leg resource ≠ the value sealed at authorize ⇒ invalid_grant (downgrade/upgrade rejection).
  it('T5: token-leg resource mismatching the sealed value ⇒ invalid_grant', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-mismatch', { resource: mcpResource, scope: 'profile' });

    const response = await tokenLeg(router, { code: 'code-mismatch', resources: ['https://other.example.com'] });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  // T5b — Token-leg sends a resource for a code that sealed none ⇒ invalid_grant.
  it('T5b: token-leg resource when none was sealed ⇒ invalid_grant', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-unsealed', { scope: 'profile' });

    const response = await tokenLeg(router, { code: 'code-unsealed', resources: [mcpResource] });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  // T6 — userinfo RS rejects a resource-aud token (keeps accepting only aud = userinfo).
  it('T6: userinfo rejects a resource-aud access token (401)', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-userinfo-reject', { resource: mcpResource, scope: 'openid profile email' });
    const tokens = (await (await tokenLeg(router, { code: 'code-userinfo-reject', resources: [mcpResource] })).json()) as { access_token: string };
    expect(decodeJwt(tokens.access_token).aud).toBe(mcpResource);

    const response = await router.request('/oauth/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(response.status).toBe(401);
  });

  // T8 — Introspection echoes the real (resource) audience.
  it('T8: introspection reports the resource audience', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true, clients: [resourceClient] });
    const { router } = createOauthRouterForTest({ ports });
    await saveOAuthCode(store, 'code-introspect-resource', { resource: mcpResource, scope: 'profile' });
    const tokens = (await (await tokenLeg(router, { code: 'code-introspect-resource', resources: [mcpResource] })).json()) as { access_token: string };

    const response = await router.request('/oauth/introspect', {
      body: formBody({ token: tokens.access_token }),
      headers: {
        authorization: basicAuth('example-rp', 'client-secret'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ active: true, aud: mcpResource });
  });
});
