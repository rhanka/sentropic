import { describe, expect, it, vi } from 'vitest';
import { createJevTransport, JEV_ENDPOINT } from '../../src/transport/jev.js';
import { jevResponse } from '../judge-fixtures.js';

describe('fixed-destination single-send JEV transport', () => {
  it('constructs without I/O and sends one bearer-authenticated JSON request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(jevResponse(), { headers: { 'x-typesafe-request-id': 'fixture:1' } }));
    const transport = createJevTransport({ fetch });
    expect(fetch).not.toHaveBeenCalled();
    const result = await transport.send('{"model":"jev-1.13.0"}', 'synthetic-key');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(JEV_ENDPOINT, expect.objectContaining({ method: 'POST', redirect: 'manual',
      headers: { authorization: 'Bearer synthetic-key', 'content-type': 'application/json', accept: 'application/json' } }));
    expect(result).toMatchObject({ ok: true, body: jevResponse(), providerRequestId: 'fixture:1' });
  });
  it.each(['', '  ', 'key\nheader'])('refuses invalid credentials before fetch', async (key) => {
    const fetch = vi.fn();
    expect(await createJevTransport({ fetch }).send('{}', key)).toMatchObject({ ok: false, error: { code: 'CREDENTIAL_MISSING' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([301, 302, 307, 308])('refuses redirect status %s without a second send', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status, headers: { location: 'https://untrusted.invalid' } }));
    expect(await createJevTransport({ fetch }).send('{}', 'synthetic-key')).toMatchObject({ ok: false, error: { code: 'PROVIDER_REJECTED' } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([new Response('not JSON', { headers: { 'content-type': 'text/plain' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('123456789', { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '99999' } })])(
    'refuses wrong media, malformed JSON or bounded-body overflow', async (response) => {
      const fetch = vi.fn().mockResolvedValue(response);
      expect((await createJevTransport({ fetch, maxResponseBytes: 8 }).send('{}', 'synthetic-key')).ok).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
    });
});
