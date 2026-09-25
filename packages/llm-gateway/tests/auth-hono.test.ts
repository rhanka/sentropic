import { describe, expect, it, vi } from 'vitest';
import { AuthHonoVerifyToken } from '../src/caller-auth/auth-hono.js';
import { createGatewayRouter, PersonalPassthroughCallerAuth, stubGatewayConfig } from '../src/index.js';
import { authContext, now, principal, sessionFixture } from './fixtures/auth-hono.js';

describe('session-only auth bridge', () => {
  it('verifies signed sessions and projects no token or mutable auth context', async () => {
    const f = await sessionFixture();
    const resolvePrincipal = vi.fn(() => principal);
    const bridge = new AuthHonoVerifyToken({ auth: { ports: f.ports }, resolvePrincipal });
    for (const scheme of ['Bearer', 'x-api-key'] as const) {
      expect(await bridge.verify(f.token, scheme, scheme === 'Bearer'
        ? { authorization: `Bearer ${f.token}` } : { 'x-api-key': f.token }, authContext)).toEqual(principal);
    }
    expect(resolvePrincipal).toHaveBeenCalledWith({ kind: 'session', userId: 'user', sessionId: 'session-user' });
    expect(JSON.stringify(resolvePrincipal.mock.calls)).not.toContain(f.token);
    expect(await bridge.verify(f.token, 'DPoP', { authorization: `DPoP ${f.token}` }, authContext)).toBeUndefined();
    expect(await bridge.verify(f.token, 'Bearer', { cookie: `session=${f.token}` }, authContext)).toBeUndefined();
    expect(await bridge.verify(f.token, 'Bearer', { authorization: 'Basic invalid', 'x-api-key': f.token }, authContext)).toBeUndefined();
  });
  it.each(['revoked', 'expired', 'disabled', 'signature', 'session-store', 'user-store', 'policy-store'])(
    'isolates %s denial/outage from all downstream activity', async failure => {
      const f = await sessionFixture();
      if (failure === 'revoked') f.session.revokedAt = now;
      if (failure === 'expired') f.session.expiresAt = now;
      if (failure === 'disabled') f.user.accountStatus = 'disabled';
      if (failure === 'session-store') f.ports.sessions.findByTokenHash = async () => { throw Error('SECRET'); };
      if (failure === 'user-store') f.ports.users.findById = async () => { throw Error('SECRET'); };
      if (failure === 'policy-store') f.ports.accountPolicy.canAuthenticate = () => { throw Error('SECRET'); };
      const access = vi.fn();
      const resolvePrincipal = vi.fn(() => principal);
      const app = createGatewayRouter({ config: { ...stubGatewayConfig,
        callerAuth: new PersonalPassthroughCallerAuth({ verifyToken:
          new AuthHonoVerifyToken({ auth: { ports: f.ports }, resolvePrincipal }) }),
        pool: { ...stubGatewayConfig.pool, snapshotModels: access, select: access },
      }, resolveTarget: access, metering: { settle: access } });
      for (const path of ['/v1/messages', '/v1/chat/completions', '/v1/models']) {
        const method = path.endsWith('models') ? 'GET' : 'POST';
        const response = await app.request(path, { method,
          headers: { authorization: `Bearer ${failure === 'signature' ? `${f.token}invalid` : f.token}` },
          ...(method === 'POST' ? { body: JSON.stringify({ model: 'm', messages: [] }) } : {}),
        });
        expect(response.status).toBe(failure.endsWith('store') ? 503 : 401);
        expect(response.headers.has('www-authenticate')).toBe(false);
        expect(await response.text()).not.toContain('SECRET');
      }
      expect(access).not.toHaveBeenCalled();
      expect(resolvePrincipal).not.toHaveBeenCalled();
    });
  it('keeps concurrent session identities separate', async () => {
    const fixtures = await Promise.all([sessionFixture('a'), sessionFixture('b')]);
    const ports = { ...fixtures[0]!.ports,
      sessions: { ...fixtures[0]!.ports.sessions, findByTokenHash: async (hash: string) => {
        const records = await Promise.all(fixtures.map(f => f.ports.sessions.findByTokenHash(hash)));
        return records.find(Boolean) ?? null;
      } },
      users: { ...fixtures[0]!.ports.users, findById: async (id: string) =>
        fixtures.find(f => f.user.id === id)!.ports.users.findById(id) },
    };
    const identities: string[] = [];
    const bridge = new AuthHonoVerifyToken({ auth: { ports }, resolvePrincipal: async identity => {
      await Promise.resolve(); identities.push(`${identity.userId}:${identity.sessionId}`); return principal;
    } });
    await Promise.all(fixtures.map(async f => {
      await bridge.verify(f.token, 'Bearer', { authorization: `Bearer ${f.token}` }, authContext);
    }));
    expect(identities.sort()).toEqual(['a:session-a', 'b:session-b']);
  });
});
