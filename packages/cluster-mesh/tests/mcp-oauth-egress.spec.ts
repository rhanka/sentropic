import { decodeJwt } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createOAuthEgress } from '../src/mcp/oauth-egress.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';
import { fixture, issuer, resource } from './packaging/fixtures/mcp-oauth/host.js';

async function setup() {
  const { options } = await fixture();
  let now = Date.now();
  const binding = new FakeTokenIssuer({ issuer, nowMs: () => now });
  const subjectToken = await binding.issueSubject({ subject: 'alice', clientId: 'immo-mcp',
    audience: [resource], scope: ['immo:read', 'immo:search'], tenantId: 'tenant' });
  const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ signals: ['synthetic'] }));
  const egress = createOAuthEgress({ ...options, exchange: {
    issuer: binding, workloadClientId: 'immo-mcp-workload', workloadActorSub: 'immo-mcp-workload',
    policyRevision: 'fixture-1', nowMs: () => now, fetchFn,
    profiles: { signals: {
      tool: 'search_signals', method: 'GET', origin: 'https://radar.internal.example',
      audience: 'https://preprod.immo.example', pathTemplate: '/api/graph-signals/:city',
      requiredScopes: ['immo:search'], validateParams: (params) => params,
    } },
  } });
  const controller = new AbortController();
  const authority = { subjectToken, correlationId: 'test-call', signal: controller.signal,
    principal: { sub: 'alice', clientId: 'immo-mcp', scopes: ['immo:read', 'immo:search'], tid: 'tenant' } };
  return { egress, authority, binding, fetchFn, controller, advance: (ms: number) => { now += ms; } };
}

describe('controlled MCP OAuth egress', () => {
  it('should send only a verified exchanged API token to the frozen destination', async () => {
    const { egress, authority, fetchFn, binding } = await setup();
    const call = egress.bind(authority, 'search_signals');
    expect(await call.capability.request('signals', { city: 'longueuil' })).toEqual({ status: 200, body: { signals: ['synthetic'] } });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://radar.internal.example/api/graph-signals/longueuil');
    expect(init?.redirect).toBe('manual');
    const header = new Headers(init?.headers).get('authorization')!;
    expect(header).not.toContain(authority.subjectToken);
    expect(decodeJwt(header.slice(7))).toMatchObject({
      sub: 'alice', aud: 'https://preprod.immo.example', client_id: 'immo-mcp-workload', act: { sub: 'immo-mcp-workload' },
    });
    await call.capability.request('signals', { city: 'longueuil' });
    expect(binding.mintCalls).toBe(1);
    call.release(); egress.close();
  });

  it('should deny other tools, scopes, profiles and unsafe city parameters before effects', async () => {
    const { egress, authority, fetchFn } = await setup();
    for (const tool of ['get_zones_geojson', 'search_lots']) {
      await expect(egress.bind(authority, tool).capability.request('signals', { city: 'longueuil' })).rejects.toHaveProperty('code', 'mcp_oauth_egress_refused');
    }
    const call = egress.bind(authority, 'search_signals');
    for (const city of ['by-city', '../admin', 'Longueuil', 'a%2fb', 'a/b', 'a\\b', '', '//evil.example']) {
      await expect(call.capability.request('signals', { city })).rejects.toHaveProperty('code', 'mcp_oauth_egress_refused');
    }
    await expect(call.capability.request('signals', { city: 'longueuil', url: 'https://evil.example' })).rejects.toThrow();
    await expect(call.capability.request('unknown', { city: 'longueuil' })).rejects.toThrow();
    await expect(egress.bind({ ...authority, principal: { ...authority.principal, scopes: ['immo:read'] } }, 'search_signals')
      .capability.request('signals', { city: 'longueuil' })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled(); egress.close();
  });

  it('should bound warm-cache outage use and refuse retained or aborted capabilities', async () => {
    const { egress, authority, binding, advance, fetchFn, controller } = await setup();
    const call = egress.bind(authority, 'search_signals');
    await call.capability.request('signals', { city: 'longueuil' });
    vi.spyOn(binding, 'mint').mockRejectedValue(new Error('synthetic private issuer error'));
    await call.capability.request('signals', { city: 'longueuil' });
    advance(60_000);
    await expect(call.capability.request('signals', { city: 'longueuil' })).rejects.toMatchObject({ reason: 'exchange_refused' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    call.release();
    await expect(call.capability.request('signals', { city: 'longueuil' })).rejects.toMatchObject({ reason: 'invocation_inactive' });
    controller.abort();
    await expect(egress.bind(authority, 'search_signals').capability.request('signals', { city: 'longueuil' })).rejects.toThrow();
    egress.close();
  });
});
