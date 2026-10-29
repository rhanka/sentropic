import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray, like } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/client';
import { settings, users, userSessions, workspaces } from '../../../src/db/schema';
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

const issuer = 'https://idp.example.test', resource = `${issuer}/remote-revocation`;
const clientId = 'test-product-revoker', path = '/api/v1/auth/session/remote-revocations';
let userId: string, directory: string;
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
  await db.delete(settings).where(like(settings.key, 'remote_session_revocation:%'));
  await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
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
async function bridge() {
  const token = await bearer(), idp = createIdpApp();
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/oauth/token')) {
      expect(new URLSearchParams(String(init.body)).get('scope')).toBe('remote.sessions.revoke');
      return Response.json({ access_token: token, token_type: 'Bearer' });
    }
    expect(url).toBe(`${revocationServiceOrigin}${path}`);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    try { return await idp.request(url, init); }
    finally { vi.stubEnv('REMOTE_ACTION_ROLE', 'product'); }
  });
  vi.stubGlobal('fetch', transport);
  return transport;
}
describe('RC1 product to issuer revocation', () => {
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
    { sub: 'user' }, { cnf: { jkt: 'bound-token' } }, { exp: 1 }])
  ('should refuse unauthorized revocation claims %j', async change => {
    const token = await bearer(change);
    const result = await createIdpApp().request(`${issuer}${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}` }, body: 'invalid' });
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: 'authentication_required' });
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
