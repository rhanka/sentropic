import { describe, expect, it } from 'vitest';
import { basicAuth } from '../__fixtures__/oauth-flow-fixtures.js';
import { refreshFixture, renew } from './refresh-fixtures.js';
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { createDpopProof } from '../__fixtures__/oauth-flow-fixtures.js';

const request = (f: Awaited<ReturnType<typeof refreshFixture>>, endpoint: string, token: string) =>
  f.router.request(`/oauth/${endpoint}`, { method: 'POST', body: new URLSearchParams({ token }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth('example-rp', 'client-secret') } });

describe('opaque refresh revoke and introspection', () => {
  it('should refuse another authenticated client before replay or revoke', async () => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    const second = await (await renew(f, first.refresh_token)).json();
    const findClient = f.ports.oauthStateStore.findClient;
    f.ports.oauthStateStore.findClient = async (id) => id === 'other-rp'
      ? { ...f.client, clientId: id } : findClient(id);
    const headers = { authorization: basicAuth('other-rp', 'client-secret') };
    const replay = await renew(f, first.refresh_token, headers);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    const revoke = await f.router.request('/oauth/revoke', { method: 'POST', headers,
      body: new URLSearchParams({ token: first.refresh_token }) });
    expect(revoke.status).toBe(400);
    expect([...f.rows.values()].every((row) => !row.revokedAt)).toBe(true);
    expect((await renew(f, second.refresh_token)).status).toBe(200);
  });

  it('should verify the original proof before replay can revoke a bound family', async () => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    const second = await (await renew(f, first.refresh_token)).json();
    const keyPair = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(keyPair.publicKey));
    f.client.dpopBoundAccessTokens = true;
    for (const row of f.rows.values()) row.dpopJkt = jkt;
    const attempt = async (token: string, dpop?: string) => f.router.request('/oauth/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }),
      headers: { authorization: basicAuth('example-rp', 'client-secret'), ...(dpop ? { dpop } : {}) },
    });
    expect(await (await attempt(first.refresh_token)).json()).toMatchObject({ error: 'invalid_dpop_proof' });
    const wrongKey = await generateKeyPair('EdDSA');
    const proof = (pair: typeof keyPair, jti: string) => createDpopProof({ keyPair: pair, jti,
      htm: 'POST', htu: 'http://localhost/oauth/token' });
    expect(await (await attempt(first.refresh_token, await proof(wrongKey, 'wrong'))).json())
      .toMatchObject({ error: 'invalid_grant' });
    expect([...f.rows.values()].every((row) => !row.revokedAt)).toBe(true);
    expect((await attempt(second.refresh_token, await proof(keyPair, 'valid'))).status).toBe(200);
  });

  it('should prevent caching revoke errors', async () => {
    const f = await refreshFixture();
    const response = await f.router.request('/oauth/revoke', { method: 'POST', body: new URLSearchParams() });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'invalid_request', error_description: expect.any(String) });
  });

  it('should introspect only the active leaf and revoke via any spent generation', async () => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    expect(await (await request(f, 'introspect', first.refresh_token)).json())
      .toMatchObject({ active: true, token_type: 'refresh_token', exp: expect.any(Number) });
    const second = await (await renew(f, first.refresh_token)).json();
    expect(await (await request(f, 'introspect', first.refresh_token)).json()).toEqual({ active: false });
    expect((await request(f, 'revoke', first.refresh_token)).status).toBe(200);
    expect(await (await request(f, 'introspect', second.refresh_token)).json()).toEqual({ active: false });
    expect((await renew(f, second.refresh_token)).status).toBe(400);
    expect((await request(f, 'revoke', 'srt_unknown')).status).toBe(200);
  });

  it('should reject wrong client authentication before destructive replay handling', async () => {
    const f = await refreshFixture();
    const first = await (await f.issue()).json();
    const second = await (await renew(f, first.refresh_token)).json();
    const wrong = await renew(f, first.refresh_token, { authorization: basicAuth('example-rp', 'wrong') });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('www-authenticate')).toContain('Basic');
    expect((await renew(f, second.refresh_token)).status).toBe(200);
  });
});
