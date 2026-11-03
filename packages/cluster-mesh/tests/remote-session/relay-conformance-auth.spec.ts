// L-6 failure-side conformance vectors (runtimeComposition.failures/.absent):
// credential absence matrix on RC0 routes, mesh routes never calling the
// provider, and TypeError only for invalid JavaScript API use — typed refusals
// never throw.
import { describe, expect, it } from 'vitest';
import { relayError } from '../../src/sessions/registry-types.js';
import { drain, engine, lease, scriptedTransport, SOURCE_ROUTE, MESH_ROUTE, STREAM_ROUTE, NOW, SESSION } from './relay-conformance-kit.js';

describe('RC2 relay-1 L-6: credential + API-use conformance vectors', () => {
  it('credential absence matrix on RC0 routes; mesh routes never call the provider', async () => {
    const foreign = lease({ sessionRef: { originInstanceId: 'other', sessionId: 'other', incarnation: 'other' } });
    const cases: Array<[string, { resolve: (ctx: unknown) => Promise<unknown> } | null, string]> = [
      ['missing provider', null, 'relay_auth_required'],
      ['null lease', { resolve: () => Promise.resolve(null) }, 'relay_auth_required'],
      ['expired lease', { resolve: () => Promise.resolve(lease({ expiresAt: NOW - 1 })) }, 'relay_grant_expired'],
      ['provider throws', { resolve: () => Promise.reject(new Error('boom')) }, 'relay_grant_unavailable'],
      ['foreign session', { resolve: () => Promise.resolve(foreign) }, 'relay_scope_refused'],
      ['malformed lease', { resolve: () => Promise.resolve({ nope: true }) }, 'relay_grant_unavailable'],
    ];
    for (const [name, provider, code] of cases) {
      const { transport } = scriptedTransport({});
      const response = await engine(transport, provider).request(SOURCE_ROUTE as never);
      expect(response, name).toMatchObject({ routeId: 'source-renew', error: { code } });
      expect('endpointRefusal' in response, name).toBe(false); // never synthesized
    }
    let providerCalls = 0;
    const { transport } = scriptedTransport({});
    const response = await engine(transport, { resolve: () => { providerCalls += 1; return Promise.resolve(lease()); } }).request(MESH_ROUTE as never);
    expect(response).toMatchObject({ routeId: 'listing-grant-fetch', response: { status: 200 } });
    expect(providerCalls).toBe(0); // additive mesh routes never call the provider
  });

  it('valid lease is applied to the mesh-internal sink before send', async () => {
    const seen: Record<string, string> = {};
    const provider = {
      resolve: () => Promise.resolve(lease({ applyTo(sink: { setSourceAuthHeader(name: string, value: string): void }) { sink.setSourceAuthHeader('x-source-auth', 'fixture'); } })),
    };
    const { transport } = scriptedTransport({});
    let sentHeaders: Record<string, string> | null = null;
    const spy = { ...transport, request: (call: unknown, signal: AbortSignal, headers: Record<string, string>) => { sentHeaders = headers; return transport.request(call as never, signal, headers); } };
    const response = await engine(spy, provider).request(SOURCE_ROUTE as never);
    expect(response).toMatchObject({ routeId: 'source-renew', response: { status: 200 } });
    expect(sentHeaders).toEqual({ 'x-source-auth': 'fixture' });
    expect(seen).toEqual({});
  });

  it('TypeError only for invalid JavaScript API use; typed refusals never throw', async () => {
    const { transport } = scriptedTransport({});
    const client = engine(transport);
    await expect(client.request(null as never)).rejects.toBeInstanceOf(TypeError);
    await expect(client.request(SOURCE_ROUTE as never, { signal: 42 } as never)).rejects.toBeInstanceOf(TypeError);
    await expect(client.close('x' as never)).rejects.toBeInstanceOf(TypeError);
    const badRoute = await client.request({ ...SOURCE_ROUTE, routeId: 'not-a-route' } as never);
    expect(badRoute).toMatchObject({ error: { code: 'relay_protocol_refused' } });
    const badStream = await drain(client.stream({ ...STREAM_ROUTE, routeId: 'listing-publish' } as never));
    expect(badStream).toEqual([{ routeId: 'listing-publish', error: relayError('relay_protocol_refused') }]);
  });

  it('session fixture stays branded and opaque', () => {
    expect(SESSION.sessionId).toBe('fixture-session');
  });
});
