import { describe, expect, it, vi } from 'vitest';
import type { RoutePlanner } from '@sentropic/llm-mesh';
import { ServiceAuthVerifyToken, type ServiceAuthCallerIdentity } from '../src/caller-auth/service-auth.js';
import { createGatewayRouter, PersonalPassthroughCallerAuth, stubGatewayConfig,
  VerifiedCostContextResolver } from '../src/index.js';
import { authContext, authFixture, now, principal } from './fixtures/auth-hono.js';

const fixture = async () => {
  const f = await authFixture();
  const resolvePrincipal = vi.fn((_identity: ServiceAuthCallerIdentity) => principal);
  const bridge = new ServiceAuthVerifyToken({ auth: f.auth, resolvePrincipal });
  const call = (token: string, scheme: 'Bearer' | 'DPoP' | 'x-api-key' = 'Bearer', extra = {}) =>
    bridge.verify(token, scheme, { ...(scheme === 'x-api-key' ? { 'X-API-KEY': token }
      : { AUTHORIZATION: `${scheme} ${token}` }), ...extra }, authContext);
  return { ...f, bridge, call, resolvePrincipal };
};

describe('canonical service auth bridge', () => {
  it('accepts Bearer and SDK aliases, projects only verified service identity concurrently', async () => {
    const f = await fixture();
    const token = await f.token();
    expect(await f.call(token)).toEqual(principal);
    expect(await f.call(token, 'x-api-key')).toEqual(principal);
    await Promise.all(['a', 'b'].map(async client_id => f.call(await f.token({ client_id }))));
    expect(f.resolvePrincipal).toHaveBeenCalledTimes(4);
    expect(f.resolvePrincipal.mock.calls.map(([identity]) => identity)).toEqual(expect.arrayContaining([
      ...['service', 'service', 'a', 'b'].map(clientId => ({ kind: 'service', issuer: f.auth.issuer,
        resource: f.auth.resource, clientId, scopes: ['gateway:invoke'], jkt: null })),
    ]));
  });
  it.each([{ iss: 'https://wrong.test' }, { aud: 'other' }, { exp: now.getTime() / 1000 - 1 },
    { scope: 'other' }])('rejects invalid token claims including the RFC 6750 scope deviation: %j', async claims => {
    const f = await fixture();
    expect(await f.call(await f.token(claims))).toBeUndefined();
    expect(f.resolvePrincipal).not.toHaveBeenCalled();
  });
  it('rejects wrong signatures, ambiguous credentials and unbound DPoP without mapping', async () => {
    const f = await fixture();
    const other = await authFixture();
    expect(await f.call(await other.token())).toBeUndefined();
    const token = await f.token();
    expect(await f.call(token, 'Bearer', { 'x-api-key': token })).toBeUndefined();
    expect(await f.call(token, 'DPoP')).toBeUndefined();
    expect(f.resolvePrincipal).not.toHaveBeenCalled();
  });
  it('accepts bound DPoP at the exact URL and rejects replay or missing proof', async () => {
    const f = await fixture();
    const token = await f.token({ cnf: { jkt: f.jkt } });
    const dpop = await f.proof(token);
    expect(await f.call(token, 'DPoP', { dpop })).toEqual(principal);
    expect(await f.call(token, 'DPoP', { dpop })).toBeUndefined();
    expect(await f.call(token, 'DPoP')).toBeUndefined();
    expect(await f.call(token, 'Bearer')).toBeUndefined();
  });
  it.each([{ htm: 'GET' }, { htu: 'https://wrong.test/v1/messages' }, { ath: 'wrong' },
    { iat: now.getTime() / 1000 - 120 }, { iat: now.getTime() / 1000 + 120 }])(
    'rejects invalid DPoP bindings: %j', async claims => {
      const f = await fixture();
      const token = await f.token({ cnf: { jkt: f.jkt } });
      expect(await f.call(token, 'DPoP', { dpop: await f.proof(token, claims) })).toBeUndefined();
      expect(f.resolvePrincipal).not.toHaveBeenCalled();
    });
  it('rejects a proof signed by a different key', async () => {
    const f = await fixture();
    const token = await f.token({ cnf: { jkt: 'wrong-key' } });
    expect(await f.call(token, 'DPoP', { dpop: await f.proof(token) })).toBeUndefined();
  });
  it.each(['replay', 'jwks', 'scope'])('maps %s outage/denial through both wires and models without downstream calls', async mode => {
    const f = await fixture();
    if (mode === 'replay') f.auth.ports.dpopReplay.recordDpopJti = async () => { throw Error('SECRET'); };
    if (mode === 'jwks') f.auth.ports.jwks.findKeyByKid = async () => { throw Error('SECRET'); };
    const bridge = new ServiceAuthVerifyToken({ auth: f.auth, resolvePrincipal: f.resolvePrincipal });
    const access = vi.fn();
    const app = createGatewayRouter({ config: { ...stubGatewayConfig,
      callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: bridge, costContextResolver: new VerifiedCostContextResolver() }),
    }, routePlanner: { plan: access, prepareAttempt: access, listModels: access } as unknown as RoutePlanner,
    routeMetering: { settleRoute: access }, publicUrl: req => `https://gateway.test${new URL(req.url).pathname}` });
    for (const path of ['/v1/messages', '/v1/chat/completions', '/v1/models']) {
      const method = path.endsWith('models') ? 'GET' : 'POST';
      const token = await f.token({ cnf: { jkt: f.jkt }, ...(mode === 'scope' ? { scope: '' } : {}) });
      const dpop = await f.proof(token, { htm: method, htu: `https://gateway.test${path}` });
      const response = await app.request(`http://internal${path}`, { method,
        headers: { authorization: `DPoP ${token}`, dpop },
        ...(method === 'POST' ? { body: JSON.stringify({ model: 'm', messages: [] }) } : {}),
      });
      expect(response.status).toBe(mode === 'scope' ? 401 : 503);
      expect(response.headers.has('www-authenticate')).toBe(false);
      expect(await response.text()).not.toContain('SECRET');
    }
    expect(access).not.toHaveBeenCalled();
    expect(f.resolvePrincipal).not.toHaveBeenCalled();
  });
  it('requires registered issuer/resource, scopes and replay at construction', async () => {
    const f = await fixture();
    for (const extra of [{ issuer: '' }, { resource: '/relative' }, { requiredScopes: [] },
      { ports: { ...f.auth.ports, dpopReplay: undefined } }]) {
      expect(() => new ServiceAuthVerifyToken({ auth: { ...f.auth, ...extra } as typeof f.auth,
        resolvePrincipal: () => principal })).toThrow();
    }
  });
});
