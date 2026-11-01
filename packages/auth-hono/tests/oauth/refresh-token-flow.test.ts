import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { oauthNow } from '../__fixtures__/oauth-fixtures.js';
import { refreshFixture, renew } from './refresh-fixtures.js';
import { basicAuth } from '../__fixtures__/oauth-flow-fixtures.js';

describe('OAuth refresh protocol', () => {
  it('should reject repeated resources without consuming the grant', async () => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    form.append('resource', 'https://resource.test/mcp');
    form.append('resource', 'https://resource.test/mcp');
    const response = await f.router.request('/oauth/token', { method: 'POST', body: form,
      headers: { authorization: basicAuth('example-rp', 'client-secret') } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_target' });
    expect((await renew(f, first.refresh_token)).status).toBe(200);
  });

  it('should issue and rotate twice with one digest, immutable claims and a sealed family', async () => {
    const f = await refreshFixture();
    const initial = await f.issue();
    expect(initial.status).toBe(200);
    expect(initial.headers.get('cache-control')).toBe('no-store');
    const first = await initial.json();
    expect(first.refresh_token).toMatch(/^srt_[A-Za-z0-9_-]{43}$/);
    const secondResponse = await renew(f, first.refresh_token, { scope: 'profile' });
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(decodeJwt(second.access_token)).toMatchObject({ scope: 'profile', amr: ['federated'] });
    const third = await (await renew(f, second.refresh_token)).json();
    expect(third.scope).toBe('openid profile offline_access');
    const rows = [...f.rows.values()];
    expect(rows.map((row) => row.generation)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
    expect(new Set(rows.map((row) => +row.familyExpiresAt))).toEqual(new Set([+oauthNow + 1296000000]));
    expect(rows[0].tokenHash).toBe(await f.ports.tokens.hashSecret(first.refresh_token));
    expect((await renew(f, first.refresh_token)).status).toBe(400);
    expect((await renew(f, third.refresh_token)).status).toBe(400);
    expect(rows.every((row) => row.revokedReason === 'reuse_detected')).toBe(true);
  });

  it.each([-1, 0, 1])('should enforce the absolute day-15 deadline at T%+is', async (delta) => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    const deadline = +oauthNow + 1296000000;
    f.advance(new Date(deadline + delta * 1000));
    const response = await renew(f, first.refresh_token);
    expect(response.status).toBe(delta < 0 ? 200 : 400);
    const body = await response.json();
    if (delta < 0) {
      expect(body.expires_in).toBe(1);
      expect(decodeJwt(body.access_token).exp! * 1000).toBeLessThanOrEqual(deadline);
    } else expect(body).toMatchObject({ error: 'invalid_grant', error_description: expect.any(String) });
  });

  it.each(['grant', 'scope', 'resource', 'acr', 'dpop', 'consent'])('should permanently revoke removed %s authority', async (kind) => {
    const f = await refreshFixture();
    const initial = await (await f.issue()).json();
    if (kind === 'grant') f.client.grantTypes = ['authorization_code'];
    if (kind === 'scope') f.client.allowedScopes = ['openid', 'offline_access'];
    if (kind === 'resource') f.client.resourceIndicators = [];
    if (kind === 'acr') f.client.requiredAcr = 'urn:sentropic:loa:bearer';
    if (kind === 'dpop') f.client.dpopBoundAccessTokens = true;
    if (kind === 'consent') f.withdraw();
    expect((await renew(f, initial.refresh_token)).status).toBe(400);
    expect([...f.rows.values()][0].revokedReason).toBe('policy_denied');
    f.client.grantTypes = ['authorization_code', 'refresh_token'];
    expect((await renew(f, initial.refresh_token)).status).toBe(400);
  });
});
