import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOAuthAuthorizeHandler } from '../../../packages/auth-hono/src/oauth/authorize-handler.ts';

// This is the committed row from the disposable SQL import, not a hand-built client.
const row = JSON.parse(readFileSync('/acceptance/immo-client.json', 'utf8'));
assert.equal(row.client_id, 'immo-mcp');
assert.equal(row.client_secret_hash, null);
assert.equal(row.token_endpoint_auth_method, 'none');
assert.equal(row.require_pkce, true);
assert.deepEqual(row.redirect_uris, ['https://claude.ai/api/mcp/auth_callback']);
assert.deepEqual(row.allowed_scopes, ['immo:read', 'immo:search', 'immo:documents:read']);
assert.deepEqual(row.resource_indicators, ['https://preprod.immo.sent-tech.ca/mcp']);
const client = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
const issuer = 'https://preprod.auth.sent-tech.ca';
let stored = client, sealed;
const now = new Date('2026-10-10T00:00:00Z');
const handler = createOAuthAuthorizeHandler({
  issuer, loginUrl: `${issuer}/auth/login`, consentUrl: `${issuer}/auth/oauth/consent`,
  ports: {
    oauthStateStore: { findClient: async id => stored?.clientId === id ? stored : null },
    cookies: { readSessionToken: () => null },
    clock: { now: () => now, addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000) },
  },
  stateCodec: { seal: async state => { sealed = state; return 'synthetic-sealed-continuation'; } },
});
const request = resource => {
  const url = new URL(`${issuer}/api/v1/auth/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: 'immo-mcp', response_type: 'code',
    redirect_uri: client.redirectUris[0], scope: client.allowedScopes.join(' '),
    code_challenge: 'synthetic-s256-proof', code_challenge_method: 'S256', resource }).toString();
  return { req: { url: url.href, raw: new Request(url), query: key => url.searchParams.get(key), queries: key => url.searchParams.getAll(key) },
    json: (body, status) => Response.json(body, { status }), redirect: (target, status) => Response.redirect(target, status) };
};
stored = null;
let response = await handler(request(client.resourceIndicators[0]));
assert.equal(response.status, 400);
assert.equal((await response.json()).error.message, 'Unknown OAuth client.');
stored = client;
response = await handler(request(client.resourceIndicators[0]));
assert.equal(response.status, 302);
const location = new URL(response.headers.get('location'));
assert.equal(location.origin + location.pathname, `${issuer}/auth/login`);
assert.equal(location.searchParams.get('continue'), 'synthetic-sealed-continuation');
assert.equal(sealed.resource, client.resourceIndicators[0]);
assert.equal(sealed.codeChallengeMethod, 'S256');
response = await handler(request('https://immo.sent-tech.ca/mcp'));
assert.equal(new URL(response.headers.get('location')).searchParams.get('error'), 'invalid_target');
console.log('PASS: imported immo-mcp authorize returns 302 to preprod login; missing client is 400; prod resource is rejected');
