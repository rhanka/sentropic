import { describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import {
  ARTIFACT_BUILDER_BASE_PATH, ARTIFACT_BUILDER_SCOPE, createBuilderMount, hostAuthenticator, parseBuilderHostBindings,
} from '../../../src/services/artifacts/live/builder-mount';

const immo = { clientId: 'immo-builder-client', hostId: 'immo', storageScopeId: 'scope-immo' };
/** Stands in for createRequireServiceAuth: verifies the bearer, then sets `serviceClient` like the real guard. */
const requireService: MiddlewareHandler = async (c, next) => {
  const [clientId, scopes] = (c.req.header('authorization') ?? '').replace(/^Bearer /, '').split(':');
  if (!clientId) return c.json({ error: 'invalid_token' }, 401);
  c.set('serviceClient' as never, { clientId, scopes: (scopes ?? '').split(','), jkt: null } as never);
  await next();
};
const bearer = (clientId: string, scopes = ARTIFACT_BUILDER_SCOPE) => ({ authorization: `Bearer ${clientId}:${scopes}` });

describe('builder host bindings (ARTIFACT_BUILDER_HOST_BINDINGS_JSON)', () => {
  it('binds each service client to one host identity', () => {
    const bindings = parseBuilderHostBindings(JSON.stringify([immo, { ...immo, clientId: 'immo-builder-client-next' }]));
    expect(bindings.get(immo.clientId)).toEqual({ hostId: 'immo', storageScopeId: 'scope-immo' });
    expect(bindings.get('immo-builder-client-next')).toEqual({ hostId: 'immo', storageScopeId: 'scope-immo' });
  });
  it('binds nothing when the value is absent, invalid or any entry is malformed (default deny)', () => {
    for (const raw of [undefined, '', 'not json', '{}', '[1]', JSON.stringify([{ ...immo, extra: 1 }]),
      JSON.stringify([{ ...immo, storageScopeId: '../scope' }]), JSON.stringify([{ ...immo, clientId: '' }]),
      JSON.stringify([immo, { ...immo, hostId: 'immo' }]), JSON.stringify([immo, { ...immo, clientId: 'other', hostId: 'other' }]),
      JSON.stringify([immo, { clientId: 'x' }]), JSON.stringify(Array.from({ length: 17 }, (_, i) => ({ ...immo, clientId: `c${i}` })))]) {
      expect(parseBuilderHostBindings(raw).size).toBe(0);
    }
  });
});

describe('builder mount (/api/v1/artifacts/builder)', () => {
  const authenticate = hostAuthenticator(parseBuilderHostBindings(JSON.stringify([immo])));
  function mounted(api: Hono | null) {
    const app = new Hono(); app.route('/', createBuilderMount({ requireService, authenticate, api })); return app;
  }
  const echo = () => { const api = new Hono(); api.post('/v1/builds', c => c.json({ host: authenticate(c) }, 202)); return api; };
  it('serves the host build API under the public base path to a bound client with the builder scope', async () => {
    const response = await mounted(echo()).request(`${ARTIFACT_BUILDER_BASE_PATH}/v1/builds`, { method: 'POST', headers: bearer(immo.clientId) });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ host: { hostId: 'immo', storageScopeId: 'scope-immo' } });
  });
  it('runs the service guard first: no token never reaches the API', async () => {
    const api = echo(); const spy = vi.spyOn(api, 'fetch');
    expect((await mounted(api).request(`${ARTIFACT_BUILDER_BASE_PATH}/v1/builds`, { method: 'POST' })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
  it('resolves no host identity without the builder scope or for an unbound client', async () => {
    const app = new Hono(); app.use('*', requireService);
    app.get('/probe', c => c.json({ host: authenticate(c) }));
    for (const headers of [bearer(immo.clientId, 'service:ping'), bearer('unbound-client')]) {
      expect(await (await app.request('/probe', { headers })).json()).toEqual({ host: null });
    }
    expect(await (await app.request('/probe', { headers: bearer(immo.clientId) })).json()).toEqual({ host: { hostId: 'immo', storageScopeId: 'scope-immo' } });
  });
  it('answers builder_unavailable to a bound host while no builder service is composed, and 403 to an unbound one', async () => {
    const app = mounted(null); const path = `${ARTIFACT_BUILDER_BASE_PATH}/v1/builds`;
    const bound = await app.request(path, { method: 'POST', headers: bearer(immo.clientId) });
    expect(bound.status).toBe(503); expect(await bound.json()).toEqual({ error: 'builder_unavailable' });
    expect((await app.request(path, { method: 'POST', headers: bearer('unbound-client') })).status).toBe(403);
  });
  it('serves nothing outside its base path', async () => {
    expect((await mounted(echo()).request('/api/v1/artifacts/other', { headers: bearer(immo.clientId) })).status).toBe(404);
  });
});
