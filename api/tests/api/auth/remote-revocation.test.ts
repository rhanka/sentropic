import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/client';
import { serviceClients, settings, users, userSessions, workspaces } from '../../../src/db/schema';
import { env } from '../../../src/config/env';
import { createSession, revokeSession, revokeAllSessions, validateSession } from '../../../src/services/session-manager';
import { getRemoteSessionAuthority } from '../../../src/services/auth/remote-private-session';
import { resolveRemoteLogin } from '../../../src/services/auth/remote-session';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { getSentropicOAuthPorts } from '../../../src/routes/auth/oauth';
import { remoteRawHash } from '../../../src/services/auth/remote-contract';
import { createIdpApp } from '../../../../apps/auth-idp/idp-app';
import { accountRouter } from '../../../src/routes/namespaces/auth/account';
import { adminRouter } from '../../../src/routes/namespaces/admin-product-authority';
import { runAdminApprovalSweep } from '../../../src/services/admin-approval-sweep';
import { signRevocation, revocationServiceOrigin } from '../../../src/services/auth/remote-revocation-transport';
import { pendingRemoteRevocations } from '../../../src/services/auth/remote-revocation-outbox';
import { sessionLifecycleHandlers } from '../../../src/routes/namespaces/session-lifecycle';

const issuer = 'https://idp.example.test', resource = `${issuer}/remote-revocation`;
const clientId = 'test-product-revoker', path = '/api/v1/auth/session/remote-revocations';
let userId: string, directory: string;
const servers: Server[] = [];
const testEnv = { DISABLE_RATE_LIMIT: env.DISABLE_RATE_LIMIT, OAUTH_ISSUER_URL: env.OAUTH_ISSUER_URL };
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rc1-product-revoke-'));
  vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
  vi.stubEnv('REMOTE_ACTION_SESSION_STATE_DIR', directory);
  vi.stubEnv('OAUTH_ISSUER_URL', issuer);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_ISSUER', issuer);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_CLIENT_ID', clientId);
  vi.stubEnv('REMOTE_ACTION_REVOCATION_CLIENT_SECRET', crypto.randomUUID());
  vi.stubEnv('REMOTE_ACTION_REVOCATION_RESOURCE', resource);
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true, role: 'editor' });
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  await db.delete(settings).where(like(settings.key, 'remote_session_revocation:%'));
  await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(serviceClients).where(eq(serviceClients.clientId, clientId));
  Object.assign(env, testEnv);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function bearer(change: Record<string, unknown> = {}) {
  const key = await createJwksAdapter().generateAndStoreNewKey();
  return new SignJWT({ iss: issuer, aud: resource, sub: clientId, client_id: clientId,
    scope: 'remote.sessions.revoke', exp: Math.floor(Date.now() / 1000) + 60, ...change })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid }).sign(key.privateKey!);
}
async function bridge(realToken = false) {
  const token = await bearer(), idp = createIdpApp();
  // Real node-server plain socket: same final hop as the deployed ClusterIP and TLS ingress.
  const server = await new Promise<Server>(resolve => {
    const listener = serve({ port: 0, hostname: '127.0.0.1', fetch: async request => {
      expect(new URL(request.url).origin).toBe(revocationServiceOrigin);
      vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
      try { return await idp.fetch(request); }
      finally { vi.stubEnv('REMOTE_ACTION_ROLE', 'product'); }
    } }, () => resolve(listener as Server));
  });
  servers.push(server);
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/oauth/token') && !realToken) {
      expect(new URLSearchParams(String(init.body)).get('scope')).toBe('remote.sessions.revoke');
      return Response.json({ access_token: token, token_type: 'Bearer' });
    }
    const target = new URL(url);
    expect([issuer, revocationServiceOrigin]).toContain(target.origin);
    // Node fetch rewrites Host for the loopback URL; node:http preserves the service Host.
    return new Promise<Response>((resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${(server.address() as AddressInfo).port}${target.pathname}`, {
        method: 'POST', headers: { ...init.headers, host: 'auth-idp:8787', 'x-forwarded-proto': 'https' },
      }, incoming => {
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve(new Response(incoming.statusCode === 204 ? null : Buffer.concat(chunks), {
          status: incoming.statusCode, headers: incoming.headers as Record<string, string>,
        })));
        incoming.on('error', reject);
      });
      request.on('error', reject);
      request.end(String(init.body));
    });
  });
  vi.stubGlobal('fetch', transport);
  return transport;
}
describe('RC1 product to issuer revocation', () => {
  it('should acknowledge more than 40 deliveries with the deployed rate limiters enabled', async () => {
    env.DISABLE_RATE_LIMIT = undefined;
    env.OAUTH_ISSUER_URL = issuer;
    await db.insert(serviceClients).values({ id: crypto.randomUUID(), clientId,
      clientSecretHash: createHash('sha256').update(process.env.REMOTE_ACTION_REVOCATION_CLIENT_SECRET!).digest('hex'),
      allowedScopes: ['remote.sessions.revoke'], resourceIndicators: [resource] });
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const transport = await bridge(true);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    // The first delivery obtains a real S2S token through the same limiter bindings.
    await revokeSession(tokens.sessionId);
    // Exhaust the anonymous peer's shared auth bucket without touching the S2S budget.
    let probe: Response | undefined;
    for (let index = 0; index < 41; index++) {
      probe = await fetch(`${revocationServiceOrigin}/api/v1/auth/rate-limit-probe`, { method: 'POST' });
    }
    expect(probe!.status).toBe(429);
    for (let index = 0; index < 60; index++) await revokeSession(crypto.randomUUID());
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
    const deliveries = transport.mock.calls.flatMap(([url], index) => url.endsWith(path) ? [index] : []);
    expect(deliveries).toHaveLength(61);
    for (const index of deliveries) {
      const response = await transport.mock.results[index].value;
      expect(response.status).toBe(204);
      expect(response.headers.get('ratelimit-policy')).toBe('120;w=60');
    }
    expect(await pendingRemoteRevocations()).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(true);
  });
  it('should charge only token-and-MAC authenticated requests to the S2S client budget', async () => {
    env.DISABLE_RATE_LIMIT = undefined;
    const transport = await bridge();
    const authorization = `Bearer ${await bearer()}`;
    const body = JSON.stringify({ sessionIds: [crypto.randomUUID()] });
    for (let index = 0; index < 121; index++) {
      const response = await fetch(`${revocationServiceOrigin}${path}`, { method: 'POST', body,
        headers: { authorization } });
      expect(response.status).toBe(401);
    }
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    for (let index = 0; index < 120; index++) await revokeSession(crypto.randomUUID());
    await expect(revokeSession(crypto.randomUUID())).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect((await transport.mock.results.at(-1)!.value).status).toBe(429);
    expect(await pendingRemoteRevocations()).toHaveLength(1);
  });
  it('should renew the cached S2S token shortly before its expiry', async () => {
    const transport = await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    await revokeSession(crypto.randomUUID());
    await revokeSession(crypto.randomUUID());
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 40_000);
    await revokeSession(crypto.randomUUID());
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(2);
  });
  it.each(['logout', 'logout-all'])('should clear both cookies and return pending 503 for unavailable %s', async operation => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const [row] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')));
    const app = new Hono().delete('/logout', c => sessionLifecycleHandlers.logout!(c))
      .delete('/logout-all', c => sessionLifecycleHandlers.logoutAll!(c));
    const response = await app.request(`https://product.example.test/${operation}`, {
      method: 'DELETE', headers: { cookie: `session=${tokens.sessionToken}; refresh_token=${tokens.refreshToken}` },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'authority_unavailable', revocation: 'pending' });
    expect(response.headers.get('set-cookie')).toContain('session=;');
    expect(response.headers.get('set-cookie')).toContain('refresh_token=;');
    expect(await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId))).toEqual([]);
    expect(await pendingRemoteRevocations()).toHaveLength(1);
    await bridge();
    await runAdminApprovalSweep();
    expect(await pendingRemoteRevocations()).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    await db.insert(userSessions).values(row);
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each(['missing-mac', 'altered-body', 'stale-stamp', 'wrong-key', 'forged-forwarded-proto'])
  ('should refuse %s on the plain HTTP final hop', async failure => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const authorization = `Bearer ${await bearer()}`;
    let body = JSON.stringify({ sessionIds: [tokens.sessionId] });
    const signed = signRevocation(body, authorization);
    if (failure === 'missing-mac') delete signed['x-revocation-mac'];
    if (failure === 'altered-body') body = JSON.stringify({ sessionIds: [tokens.sessionId], userId });
    if (failure === 'stale-stamp') signed['x-revocation-stamp'] = `1000000000000:${crypto.randomUUID()}`;
    if (failure === 'wrong-key') vi.stubEnv('REMOTE_ACTION_REVOCATION_CLIENT_SECRET', crypto.randomUUID());
    const url = failure === 'forged-forwarded-proto' ? `http://idp.example.test${path}` : `${revocationServiceOrigin}${path}`;
    const response = await createIdpApp().request(url, { method: 'POST', body,
      headers: { authorization, ...signed, 'x-forwarded-proto': 'https' } });
    expect(response.status).toBe(failure === 'forged-forwarded-proto' ? 403 : 401);
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(false);
  });
  it('should retain a retry intent when an intermediary forges a 204 acknowledgement', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const token = await bearer();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/oauth/token')
      ? Response.json({ access_token: token, token_type: 'Bearer' })
      : new Response(null, { status: 204, headers: { 'x-revocation-ack': '0'.repeat(64) } })));
    await expect(revokeSession(tokens.sessionId)).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect(await pendingRemoteRevocations()).toHaveLength(1);
    await bridge();
    await runAdminApprovalSweep();
    expect(await pendingRemoteRevocations()).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(true);
  });
  function lifecycleApp(workspaceId: string, admin = false) {
    return new Hono().use('*', async (c, next) => {
      c.set('user', { userId: admin ? 'test-admin' : userId, workspaceId,
        sessionId: 'test-session', role: admin ? 'admin_app' : 'editor' });
      await next();
    }).route('/account', accountRouter).route('/admin', adminRouter);
  }
  it.each(['self-deactivate', 'self-delete', 'admin-disable', 'admin-delete', 'approval-sweep'])
  ('should tombstone issuer authority through the actual %s lifecycle', async operation => {
    const workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: userId, name: 'RC1 lifecycle' });
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const [session] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    expect(await resolveRemoteLogin(tokens.sessionToken)).not.toBeNull();
    await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    if (operation === 'admin-delete') await db.update(users).set({ accountStatus: 'disabled_by_admin' }).where(eq(users.id, userId));
    if (operation === 'approval-sweep') {
      // Scope the selected candidates; DB writes and issuer delivery remain real.
      await db.update(users).set({ accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(Date.now() + 3_600_000) }).where(eq(users.id, userId));
      const candidates = { from: () => ({ where: async () => [{ id: userId }] }) };
      vi.spyOn(db, 'select').mockReturnValueOnce(candidates as unknown as ReturnType<typeof db.select>);
      expect((await runAdminApprovalSweep()).expiredCount).toBe(1);
    } else {
      const admin = operation.startsWith('admin');
      const endpoint = admin ? `/admin/users/${userId}${operation === 'admin-disable' ? '/disable' : ''}`
        : `/account${operation === 'self-deactivate' ? '/deactivate' : ''}`;
      const response = await lifecycleApp(workspaceId, admin).request(`https://product.example.test${endpoint}`, {
        method: operation.endsWith('delete') ? 'DELETE' : 'POST',
        ...(operation === 'admin-disable' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
      });
      expect(response.status).toBe(200);
    }
    expect(await db.select().from(userSessions).where(eq(userSessions.userId, userId))).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(true);
    await db.insert(users).values(user).onConflictDoUpdate({ target: users.id, set: user });
    await db.insert(userSessions).values(session);
    expect(await validateSession(tokens.sessionToken)).toMatchObject({ userId });
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each(['self-deactivate', 'self-delete', 'admin-disable', 'admin-delete'])
  ('should commit %s destruction even when issuer delivery fails', async operation => {
    const workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: userId, name: 'RC1 failed delivery' });
    await createSession(userId, 'editor', undefined, { mfaVerified: true });
    if (operation === 'admin-delete') await db.update(users).set({ accountStatus: 'disabled_by_admin' }).where(eq(users.id, userId));
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')));
    const admin = operation.startsWith('admin');
    const endpoint = admin ? `/admin/users/${userId}${operation === 'admin-disable' ? '/disable' : ''}`
      : `/account${operation === 'self-deactivate' ? '/deactivate' : ''}`;
    const response = await lifecycleApp(workspaceId, admin).request(`https://product.example.test${endpoint}`, {
      method: operation.endsWith('delete') ? 'DELETE' : 'POST',
      ...(operation === 'admin-disable' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'authority_unavailable', revocation: 'pending' });
    expect(response.headers.get('retry-after')).toBe('60');
    if (admin) expect(response.headers.get('set-cookie')).toBeNull();
    else {
      expect(response.headers.get('set-cookie')).toContain('session=;');
      expect(response.headers.get('set-cookie')).toContain('refresh_token=;');
    }
    if (operation.endsWith('delete')) expect(await db.select().from(users).where(eq(users.id, userId))).toEqual([]);
    expect(await db.select().from(userSessions).where(eq(userSessions.userId, userId))).toEqual([]);
    if (operation.endsWith('delete')) expect(await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toEqual([]);
    expect(await pendingRemoteRevocations()).toHaveLength(1);
    await bridge();
    // No user or session row is needed to drain a committed intent on a later scheduled sweep.
    await runAdminApprovalSweep();
    expect(await pendingRemoteRevocations()).toEqual([]);
  });
  it('should expire every selected user even when all issuer deliveries fail', async () => {
    const otherId = crypto.randomUUID();
    await db.insert(users).values({ id: otherId, email: `${otherId}@example.test`, emailVerified: true, role: 'editor' });
    try {
      const first = await createSession(userId, 'editor', undefined, { mfaVerified: true });
      const second = await createSession(otherId, 'editor', undefined, { mfaVerified: true });
      await db.update(users).set({ accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(Date.now() + 3_600_000) }).where(inArray(users.id, [userId, otherId]));
      const candidates = { from: () => ({ where: async () => [{ id: userId }, { id: otherId }] }) };
      vi.spyOn(db, 'select').mockReturnValueOnce(candidates as unknown as ReturnType<typeof db.select>);
      const transport = vi.fn().mockRejectedValue(new Error('issuer unavailable'));
      vi.stubGlobal('fetch', transport);
      vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
      await expect(runAdminApprovalSweep()).resolves.toEqual({ expiredCount: 2 });
      expect(transport).toHaveBeenCalledTimes(2);
      expect(await db.select().from(userSessions).where(inArray(userSessions.userId, [userId, otherId]))).toEqual([]);
      vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
      expect(await resolveRemoteLogin(first.sessionToken)).toBeNull();
      expect(await resolveRemoteLogin(second.sessionToken)).toBeNull();
    } finally { await db.delete(users).where(eq(users.id, otherId)); }
  });
  it.each(['logout', 'revoke-all', 'oauth-logout', 'oauth-revoke-all'])
  ('should persist issuer tombstones for product %s before returning', async operation => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    if (operation.includes('all')) await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const rows = await db.select().from(userSessions).where(eq(userSessions.userId, userId));
    const transport = await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    if (operation === 'logout') await revokeSession(tokens.sessionId);
    if (operation === 'revoke-all') await revokeAllSessions(userId);
    if (operation === 'oauth-logout') await getSentropicOAuthPorts().sessions.revoke(tokens.sessionId);
    if (operation === 'oauth-revoke-all') await getSentropicOAuthPorts().sessions.revokeAllForUser(userId);
    expect(transport).toHaveBeenCalledTimes(2);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    for (const row of rows) expect(getRemoteSessionAuthority()!.find(row.id)?.revoked).toBe(true);
    expect(await db.select().from(userSessions).where(eq(userSessions.userId, userId))).toEqual([]);
    await db.insert(userSessions).values(rows);
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each([{ scope: 'remote.evidence.issue' }, { aud: 'other' }, { client_id: 'other' },
    { sub: 'user' }, { cnf: { jkt: 'bound-token' } }, { exp: 1 }, {}])
  ('should enforce revocation token claims with an authenticated body %j', async change => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const authorization = `Bearer ${await bearer(change)}`;
    const body = JSON.stringify({ sessionIds: [tokens.sessionId] });
    const result = await createIdpApp().request(`${issuer}${path}`, { method: 'POST',
      headers: { authorization, ...signRevocation(body, authorization) }, body });
    const valid = Object.keys(change).length === 0;
    expect(result.status).toBe(valid ? 204 : 401);
    if (!valid) expect(await result.json()).toEqual({ error: 'authentication_required' });
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(valid);
  });
  it('should delete the DB session even when issuer delivery fails', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const [row] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(revokeSession(tokens.sessionId)).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect(await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId))).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
    // Retry still tombstones the issuer record after the shared row is already gone.
    await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    await revokeSession(tokens.sessionId);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    await db.insert(userSessions).values(row);
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
  });
  it.each(['lock', 'corrupt-file', 'missing-pvc'])
  ('should delete product sessions and keep issuer authority closed on %s', async failure => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const [row] = await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId));
    await bridge();
    if (failure === 'lock') mkdirSync(join(directory, `${remoteRawHash(tokens.sessionId)}.json.lock`));
    if (failure === 'corrupt-file') writeFileSync(join(directory, `${'0'.repeat(64)}.json`), '{');
    if (failure === 'missing-pvc') rmSync(directory, { recursive: true });
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    await expect(revokeAllSessions(userId)).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect(await db.select().from(userSessions).where(eq(userSessions.userId, userId))).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    await db.insert(userSessions).values(row);
    await expect(resolveRemoteLogin(tokens.sessionToken)).rejects.toMatchObject({ code: 'authority_unavailable' });
  });
  it('should refuse an active product composition missing its issuer configuration after DB removal', async () => {
    const tokens = await createSession(userId, 'editor');
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubEnv('REMOTE_ACTION_REVOCATION_ISSUER', '');
    await expect(revokeSession(tokens.sessionId)).rejects.toMatchObject({ code: 'authority_unavailable' });
    expect(await db.select().from(userSessions).where(eq(userSessions.id, tokens.sessionId))).toEqual([]);
  });
  it.each(['browser', 'cookie', 'http', 'extra-field', 'duplicate', 'oversize', 'empty', 'anonymous'])
  ('should refuse %s revocation requests without writing authority', async failure => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const headers: Record<string, string> = { authorization: `Bearer ${await bearer()}` };
    if (failure === 'browser') headers.origin = 'https://product.example.test';
    if (failure === 'cookie') headers.cookie = 'session=browser';
    if (failure === 'anonymous') delete headers.authorization;
    const body = failure === 'duplicate' ? '{"sessionIds":[],"sessionIds":[]}'
      : failure === 'oversize' ? 'x'.repeat(8193) : failure === 'empty' ? '{"sessionIds":[]}'
        : JSON.stringify({ sessionIds: [tokens.sessionId], ...(failure === 'extra-field' ? { restore: true } : {}) });
    Object.assign(headers, signRevocation(body, headers.authorization ?? ''));
    const result = await createIdpApp().request(`${failure === 'http' ? 'http://idp.example.test' : issuer}${path}`,
      { method: 'POST', headers, body });
    expect(result.status).toBe(['browser', 'cookie', 'http'].includes(failure) ? 403 : failure === 'anonymous' ? 401 : 400);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(false);
  });
});
