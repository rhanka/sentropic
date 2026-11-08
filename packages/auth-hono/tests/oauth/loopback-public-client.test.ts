import { describe, expect, it } from 'vitest';
import { authorizePath } from '../__fixtures__/oauth-fixtures.js';
import { oauthChallenge, publicTokenRequest } from '../__fixtures__/oauth-flow-fixtures.js';
import { refreshFixture } from './refresh-fixtures.js';
import { createWellKnownRouter, matchesRegisteredRedirectUri } from '../../src/index.js';

const LOOPBACK = 'http://127.0.0.1/callback';
const RESOURCE = 'https://resource.test/mcp';

describe('RFC 8252 loopback redirect matching', () => {
  it('should accept any port for a registered port-less loopback IP URI only', () => {
    for (const uri of ['http://127.0.0.1:53682/callback', 'http://127.0.0.1:1/callback', LOOPBACK]) {
      expect(matchesRegisteredRedirectUri([LOOPBACK], uri)).toBe(true);
    }
    expect(matchesRegisteredRedirectUri(['http://[::1]/callback'], 'http://[::1]:40000/callback')).toBe(true);
    for (const uri of ['http://127.0.0.1:5000/other', 'http://127.0.0.1:5000/callback?x=1',
      'http://127.0.0.1:05000/callback', 'http://localhost:5000/callback', 'https://127.0.0.1:5000/callback',
      'http://a@127.0.0.1:5000/callback', 'http://127.0.0.1:5000/callback#f', 'http://127.0.0.2:5000/callback',
      'http://127.0.0.1.evil.test:5000/callback']) {
      expect(matchesRegisteredRedirectUri([LOOPBACK], uri)).toBe(false);
    }
    // An entry WITH a port, `localhost`, or `:80` keeps exact matching.
    expect(matchesRegisteredRedirectUri(['http://127.0.0.1:8080/callback'], 'http://127.0.0.1:9090/callback')).toBe(false);
    expect(matchesRegisteredRedirectUri(['http://localhost/callback'], 'http://localhost:9090/callback')).toBe(false);
    expect(matchesRegisteredRedirectUri(['http://127.0.0.1:80/callback'], 'http://127.0.0.1:9090/callback')).toBe(false);
  });
});

describe('public loopback CLI client (PKCE + rotating refresh)', () => {
  const publicLoopbackFixture = async () => {
    const f = await refreshFixture();
    Object.assign(f.client, { tokenEndpointAuthMethod: 'none', clientSecretHash: null, redirectUris: [LOOPBACK] });
    return f;
  };
  const publicRefresh = (f: Awaited<ReturnType<typeof refreshFixture>>, token: string) => publicTokenRequest(f.router, {
    client_id: 'example-rp', grant_type: 'refresh_token', refresh_token: token,
    code_verifier: undefined, redirect_uri: undefined,
  });

  it('should issue on an ephemeral port, rotate without a secret and detect replay', async () => {
    const f = await publicLoopbackFixture();
    const redirectUri = 'http://127.0.0.1:53682/callback';
    const authorize = await f.router.request(authorizePath({ code_challenge: oauthChallenge,
      redirect_uri: redirectUri, resource: RESOURCE, scope: 'profile offline_access' }));
    const location = new URL(authorize.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    const code = location.searchParams.get('code')!;
    expect(code).toBeTruthy();
    // The token request must repeat the exact (ported) redirect_uri of the authorization request.
    expect((await publicTokenRequest(f.router, { client_id: 'example-rp', code,
      redirect_uri: 'http://127.0.0.1:53683/callback', resource: RESOURCE })).status).toBe(400);
    const issued = await publicTokenRequest(f.router, { client_id: 'example-rp', code, redirect_uri: redirectUri, resource: RESOURCE });
    expect(issued.status).toBe(200);
    const first = await issued.json();
    expect(first.refresh_token).toMatch(/^srt_/u);
    const rotated = await publicRefresh(f, first.refresh_token);
    expect(rotated.status).toBe(200);
    const second = await rotated.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await publicRefresh(f, first.refresh_token)).status).toBe(400);
    expect([...f.rows.values()].every((row) => row.revokedReason === 'reuse_detected')).toBe(true);
    expect((await publicRefresh(f, second.refresh_token)).status).toBe(400);
  });

  it('should refuse an unregistered loopback path and client credentials from the public client', async () => {
    const f = await publicLoopbackFixture();
    const bad = await f.router.request(authorizePath({ code_challenge: oauthChallenge,
      redirect_uri: 'http://127.0.0.1:53682/other', scope: 'profile offline_access' }));
    expect(bad.status).toBe(400);
    // f.issue() sends HTTP Basic credentials: a public (`none`) client must never present a secret.
    const withSecret = await f.issue();
    expect(withSecret.status).toBe(401);
    expect((await withSecret.json()).error).toBe('invalid_client');
  });

  it('should advertise refresh_token and offline_access for the client-scoped discovery', async () => {
    const f = await publicLoopbackFixture();
    const discovery = createWellKnownRouter({ issuer: 'http://localhost:9197', ports: f.ports });
    const scoped = await (await discovery.request('/oauth-authorization-server?client_id=example-rp')).json();
    expect(scoped.grant_types_supported).toContain('refresh_token');
    expect(scoped.scopes_supported).toContain('offline_access');
    expect(scoped.token_endpoint_auth_methods_supported).toContain('none');
  });
});
