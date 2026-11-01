import { describe, expect, it } from 'vitest';
import { basicAuth } from '../__fixtures__/oauth-flow-fixtures.js';
import { refreshFixture, renew } from './refresh-fixtures.js';

const request = (f: Awaited<ReturnType<typeof refreshFixture>>, endpoint: string, token: string) =>
  f.router.request(`/oauth/${endpoint}`, { method: 'POST', body: new URLSearchParams({ token }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth('example-rp', 'client-secret') } });

describe('opaque refresh revoke and introspection', () => {
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
