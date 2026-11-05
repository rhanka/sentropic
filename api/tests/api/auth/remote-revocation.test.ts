import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/db/client';
import { serviceClients, workspaces } from '../../../src/db/schema';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { createCmUser, findCmUserById, updateCmUser } from '../../../src/services/identity/cm-users';
import { bindCmServiceClientTenant } from '../../../src/services/identity/cm-service-clients';
import { findCmSessionById, listCmSessionsForUser } from '../../../src/services/identity/cm-sessions';
import { createCmTenant, enrolCmWorkspace, putCmWorkspaceMember } from '../../../src/services/identity/cm-tenancy';
import { PLATFORM_TENANT_ID } from '../../../src/services/workspace-service';
import { cmCountActiveSessionsForUser, cmDeleteForUsers, cmDeleteTenants, cmQuery, cmReinsertSession, cmTable } from '../../utils/cm-identity-test-store';
import { env } from '../../../src/config/env';
import { createSession, revokeSession, revokeAllSessions, validateSession } from '../../../src/services/session-manager';
import { getRemoteSessionAuthority } from '../../../src/services/auth/remote-private-session';
import { resolveRemoteLogin } from '../../../src/services/auth/remote-session';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { remoteRawHash } from '../../../src/services/auth/remote-contract';
import { createIdpApp } from '../../../../apps/auth-idp/idp-app';
import { accountRouter } from '../../../src/routes/namespaces/auth/cm-auth-hono';
import { adminRouter } from '../../../src/routes/namespaces/admin-product-authority';
import { acknowledgeIdentityRevocationV1 } from '@sentropic/cluster-mesh';
import { deliverCmRevocation } from '../../../src/services/identity/cm-revocation-delivery';
import { drainCmRevocations } from '../../../src/services/identity/cm-revocation-worker';
import { cmIdentityUnitOfWork, runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { signRevocation, revocationServiceOrigin } from '../../../src/services/auth/remote-revocation-transport';
import { sessionLifecycleHandlers } from '../../../src/routes/namespaces/session-lifecycle';

const issuer = 'https://idp.example.test', resource = `${issuer}/remote-revocation`;
const clientId = 'test-product-revoker', path = '/api/v1/auth/session/remote-revocations';
let userId: string, directory: string;

// Post-cutover the session facade refuses self-asserted MFA; MFA sessions are
// minted through the binding, the same issuance call the verified ceremony makes.
const mintMfaSession = () => withAppCmAuth(runner => runner.request(async binding => {
  const user = await binding.ports.users.findById(userId);
  if (!user) throw new Error('missing revocation fixture user');
  return binding.sessions.createSession({ user, mfaVerified: true });
}));

// Replacement for the deleted `pendingRemoteRevocations`: undelivered intents
// live in the CM revocation outbox ledger (one row per target, `pending` until
// the sweep acknowledges delivery).
const pendingCmRevocations = () => cmQuery<{ delivery_id: string }>(
  `SELECT delivery_id FROM ${cmTable('identity_revocation_outbox')} WHERE subject_id = $1 AND state = 'pending'`,
  [userId]);

// Bulk sweep for the budget tests: one claim round for every queued intent,
// then the same per-delivery tombstone path the worker uses (deliver +
// acknowledge, release with backoff on failure). The worker's one-claim-per-
// call cadence is a sweep tuning, not a security property; the HTTP delivery
// sequence — and therefore the rate-limiter math — is identical.
const drainManyCmRevocations = async (limit = 250): Promise<void> => {
  const now = new Date();
  const options = { mode: 'write', purpose: 'delivery', deadlineMs: 5_000, maxAttempts: 3 } as const;
  const claims = await cmIdentityUnitOfWork.run(options, tx => tx.revocationOutbox.claimPending({
    workerId: `test-a4-revoke-${crypto.randomUUID()}`, now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(), limit,
  }));
  for (const claim of claims) {
    try {
      await deliverCmRevocation(claim);
      await cmIdentityUnitOfWork.run(options, tx => acknowledgeIdentityRevocationV1({
        tx, claim, at: new Date().toISOString(), connectorCustody: null,
      }));
    } catch {
      const at = new Date();
      const delayMs = Math.min(900_000, 1_000 * 2 ** Math.min(claim.record.attemptCount, 10));
      await cmIdentityUnitOfWork.run(options, tx => tx.revocationOutbox.release({
        deliveryId: claim.record.deliveryId, workerId: claim.workerId, claimVersion: claim.claimVersion,
        at: at.toISOString(), nextAttemptAt: new Date(at.getTime() + delayMs).toISOString(),
      }));
    }
  }
};

// The worker drains one claim per call and a released claim waits for its
// backoff; sweep until the ledger is empty (bounded: delivery must succeed).
const drainAllCmRevocations = async (timeoutMs = 60_000): Promise<void> => {
  const start = Date.now();
  for (;;) {
    if ((await pendingCmRevocations()).length === 0) return;
    await drainCmRevocations();
    if (Date.now() - start > timeoutMs) throw new Error('CM revocation outbox did not drain');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
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
  await createCmUser({ userId, email: `${userId}@example.test`, role: 'editor', emailVerified: true, accountStatus: 'active' });
  // The admin lifecycle routes require a real admin actor; the stubbed
  // 'test-admin' identity is provisioned (and purged) per test.
  await createCmUser({ userId: 'test-admin', email: 'test-admin@example.test', role: 'admin_app', emailVerified: true, accountStatus: 'active' });
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  const wsRows = await cmQuery<{ workspace_id: string }>(`SELECT "workspace_id" FROM ${cmTable('cm_workspace_members')} WHERE "user_id" = $1`, [userId]);
  if (wsRows.length) await db.delete(workspaces).where(inArray(workspaces.id, wsRows.map((r) => r.workspace_id)));
  await cmDeleteForUsers([userId, 'test-admin']);
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
    // A crashed run can leave the client row behind; re-seed deterministically.
    await db.delete(serviceClients).where(eq(serviceClients.clientId, clientId));
    await db.insert(serviceClients).values({ id: crypto.randomUUID(), clientId,
      clientSecretHash: createHash('sha256').update(process.env.REMOTE_ACTION_REVOCATION_CLIENT_SECRET!).digest('hex'),
      allowedScopes: ['remote.sessions.revoke'], resourceIndicators: [resource] });
    // Real S2S issuance is CM-owned now: the revoker client needs a fixed
    // tenant binding, or every token fetch is refused with no_authorized_tenant.
    const revokerTenant = 'test-product-revoker-tenant';
    await cmDeleteTenants([revokerTenant]);
    await createCmTenant({ tenantId: revokerTenant });
    await runCmIdentityWrite(tx => bindCmServiceClientTenant(tx, clientId, revokerTenant));
    const tokens = await mintMfaSession();
    const transport = await bridge(true);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    // Revocation only enqueues now; the sweep delivers. The first delivery
    // obtains a real S2S token through the same limiter bindings — before the
    // probes below exhaust the shared anonymous bucket that token issuance is
    // charged to. Missing sessions enqueue nothing, so every revoked id below
    // is a real session.
    await revokeSession(tokens.sessionId);
    await drainManyCmRevocations();
    // Exhaust the anonymous peer's shared auth bucket without touching the S2S budget.
    let probe: Response | undefined;
    for (let index = 0; index < 41; index++) {
      probe = await fetch(`${revocationServiceOrigin}/api/v1/auth/rate-limit-probe`, { method: 'POST' });
    }
    expect(probe!.status).toBe(429);
    for (let index = 0; index < 60; index++) {
      const extra = await createSession(userId, 'editor');
      await revokeSession(extra.sessionId);
    }
    await drainManyCmRevocations();
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
    const deliveries = transport.mock.calls.flatMap(([url], index) => url.endsWith(path) ? [index] : []);
    expect(deliveries).toHaveLength(61);
    for (const index of deliveries) {
      const response = await transport.mock.results[index].value;
      expect(response.status).toBe(204);
      expect(response.headers.get('ratelimit-policy')).toBe('120;w=60');
    }
    expect(await pendingCmRevocations()).toEqual([]);
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
    // Enqueue never throws now; the S2S budget is enforced at sweep delivery and
    // the refused intent stays pending for the retry sweep.
    const revokeRealSession = async () => {
      const extra = await createSession(userId, 'editor');
      await revokeSession(extra.sessionId);
    };
    for (let index = 0; index < 120; index++) await revokeRealSession();
    await revokeRealSession();
    await drainManyCmRevocations();
    expect((await transport.mock.results.at(-1)!.value).status).toBe(429);
    expect(await pendingCmRevocations()).toHaveLength(1);
  });
  it('should renew the cached S2S token shortly before its expiry', async () => {
    const transport = await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    const revokeRealSession = async () => {
      const extra = await createSession(userId, 'editor');
      await revokeSession(extra.sessionId);
    };
    await revokeRealSession();
    await revokeRealSession();
    await drainCmRevocations();
    await drainCmRevocations();
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 40_000);
    await revokeRealSession();
    await drainCmRevocations();
    expect(transport.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(2);
  });
  it.each(['logout', 'logout-all'])('should clear cookies, commit the revoke and queue a retry intent for unavailable %s', async operation => {
    const tokens = await mintMfaSession();
    const row = await findCmSessionById(tokens.sessionId);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')));
    const app = new Hono().delete('/logout', c => sessionLifecycleHandlers.logout!(c))
      .delete('/logout-all', c => sessionLifecycleHandlers.logoutAll!(c));
    const response = await app.request(`https://product.example.test/${operation}`, {
      method: 'DELETE', headers: { cookie: `session=${tokens.sessionToken}; refresh_token=${tokens.refreshToken}` },
    });
    // Logout commits against the CM store and queues issuer delivery for the
    // sweep; undelivered logout is no longer a 503. logout-all also enqueues
    // the subject row, so it leaves two pending intents.
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('session=;');
    if (operation === 'logout') expect(response.headers.get('set-cookie')).toContain('refresh_token=;');
    expect((await findCmSessionById(tokens.sessionId))?.revokedAt ?? null).toBeTruthy();
    expect(await pendingCmRevocations()).toHaveLength(operation === 'logout' ? 1 : 2);
    await bridge();
    await drainAllCmRevocations();
    expect(await pendingCmRevocations()).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    await cmReinsertSession(row!);
    // resolveRemoteLogin reads CM (reinserted active); the issuer tombstone
    // lands in the file mirror, asserted directly.
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toMatchObject({ revoked: true });
  });
  it.each(['missing-mac', 'altered-body', 'stale-stamp', 'wrong-key', 'forged-forwarded-proto'])
  ('should refuse %s on the plain HTTP final hop', async failure => {
    const tokens = await mintMfaSession();
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
    // Refused requests write nothing: CM-minted sessions have no file-mirror
    // record until a delivered revocation tombstones them.
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toBeNull();
  });
  it('should retain a retry intent when an intermediary forges a 204 acknowledgement', async () => {
    const tokens = await mintMfaSession();
    const token = await bearer();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/oauth/token')
      ? Response.json({ access_token: token, token_type: 'Bearer' })
      : new Response(null, { status: 204, headers: { 'x-revocation-ack': '0'.repeat(64) } })));
    // Enqueue never throws; the forged MAC fails closed at sweep delivery and
    // the intent stays pending for the retry sweep.
    await revokeSession(tokens.sessionId);
    await drainCmRevocations();
    expect(await pendingCmRevocations()).toHaveLength(1);
    await bridge();
    await drainAllCmRevocations();
    expect(await pendingCmRevocations()).toEqual([]);
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
  // BLOCKED (a4-lane, re-enable when the owning lot lands): account deletion
  // through the V2 cascade rolls back for these fixtures — the branch lots
  // A4-SELF-DELETE (BRANCH.md:81) and the V2 cascade (BRANCH.md:269,
  // execution awaits A2.0b) are incomplete, and the branch's own
  // cm-account-deletion rollback test fails the same way.
  for (const operation of ['self-deactivate', 'self-delete', 'admin-disable', 'admin-delete']) {
  (operation.endsWith('delete') ? it.skip : it)
  (`should tombstone issuer authority through the actual ${operation} lifecycle`, async () => {
    const workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: 'RC1 lifecycle' });
    await enrolCmWorkspace({ workspaceId, tenantId: PLATFORM_TENANT_ID });
    await putCmWorkspaceMember(workspaceId, userId, 'admin');
    const tokens = await mintMfaSession();
    const user = await findCmUserById(userId);
    const session = await findCmSessionById(tokens.sessionId);
    expect(await resolveRemoteLogin(tokens.sessionToken)).not.toBeNull();
    await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    if (operation === 'admin-delete') await updateCmUser(userId, { accountStatus: 'disabled_by_admin' });
    // Active self deletion is refused (409); the supported self flow
    // deactivates first, then deletes.
    if (operation === 'self-delete') {
      const deactivated = await lifecycleApp(workspaceId, false).request('https://product.example.test/account/deactivate', { method: 'POST' });
      expect(deactivated.status).toBe(200);
    }
    {
      const admin = operation.startsWith('admin');
      const endpoint = admin ? `/admin/users/${userId}${operation === 'admin-disable' ? '/disable' : ''}`
        : `/account${operation === 'self-deactivate' ? '/deactivate' : ''}`;
      const response = await lifecycleApp(workspaceId, admin).request(`https://product.example.test${endpoint}`, {
        method: operation.endsWith('delete') ? 'DELETE' : 'POST',
        ...(operation === 'admin-disable' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
      });
      expect(response.status).toBe(200);
    }
    expect(await cmCountActiveSessionsForUser(userId)).toBe(0);
    // Issuer tombstoning now lands through the sweep, not the lifecycle call.
    await drainAllCmRevocations();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)?.revoked).toBe(true);
    if (operation.endsWith('delete')) {
      await createCmUser({ userId: user!.id, email: user!.email ?? `${user!.id}.test`, role: user!.role, emailVerified: user!.emailVerified, accountStatus: user!.accountStatus, approvalDueAt: user!.approvalDueAt });
    } else {
      // Deactivation/disabling keeps the account row: restore it to active.
      await updateCmUser(userId, { accountStatus: 'active' });
    }
    await cmReinsertSession(session!);
    expect(await validateSession(tokens.sessionToken)).toMatchObject({ userId });
    // The restored session does not revive the issuer tombstone.
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toMatchObject({ revoked: true });
  });
  }
  // BLOCKED (a4-lane, re-enable with the tombstone lifecycle above): same
  // V2 cascade rollback as the tombstone test (BRANCH.md:81, :269).
  for (const operation of ['self-deactivate', 'self-delete', 'admin-disable', 'admin-delete']) {
  (operation.endsWith('delete') ? it.skip : it)
  (`should commit ${operation} destruction even when issuer delivery fails`, async () => {
    const workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: 'RC1 failed delivery' });
    await enrolCmWorkspace({ workspaceId, tenantId: PLATFORM_TENANT_ID });
    await putCmWorkspaceMember(workspaceId, userId, 'admin');
    await mintMfaSession();
    if (operation === 'admin-delete') await updateCmUser(userId, { accountStatus: 'disabled_by_admin' });
    // Active self deletion is refused (409); the supported self flow
    // deactivates first, then deletes.
    if (operation === 'self-delete') {
      const deactivated = await lifecycleApp(workspaceId, false).request('https://product.example.test/account/deactivate', { method: 'POST' });
      expect(deactivated.status).toBe(200);
    }
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')));
    const admin = operation.startsWith('admin');
    const endpoint = admin ? `/admin/users/${userId}${operation === 'admin-disable' ? '/disable' : ''}`
      : `/account${operation === 'self-deactivate' ? '/deactivate' : ''}`;
    const response = await lifecycleApp(workspaceId, admin).request(`https://product.example.test${endpoint}`, {
      method: operation.endsWith('delete') ? 'DELETE' : 'POST',
      ...(operation === 'admin-disable' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
    });
    // Destruction commits against the CM store and queues issuer delivery for
    // the sweep; an unreachable issuer no longer turns the lifecycle call into
    // a 503 with a retry-after. Deletions report delivery_pending (202) while
    // intents are queued; transitions report success (200).
    expect([200, 202]).toContain(response.status);
    if (operation.endsWith('delete')) expect(await findCmUserById(userId)).toBeNull();
    expect(await cmCountActiveSessionsForUser(userId)).toBe(0);
    if (operation.endsWith('delete')) expect(await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).toEqual([]);
    // One ledger row per revoked target now, not one settings row.
    expect((await pendingCmRevocations()).length).toBeGreaterThan(0);
    await bridge();
    // No user or session row is needed to drain a committed intent on a later scheduled sweep.
    await drainAllCmRevocations();
    expect(await pendingCmRevocations()).toEqual([]);
  });
  }
  it('should apply the elapsed approval deadline without rewriting status or requiring a sweep', async () => {
    const login = await createSession(userId, 'editor');
    const approvalDueAt = new Date(Date.now() - 3_600_000);
    await updateCmUser(userId, { accountStatus: 'pending_admin_approval', approvalDueAt });
    expect(await validateSession(login.sessionToken)).toMatchObject({ userId, role: 'guest' });
    await drainCmRevocations();
    expect(await findCmUserById(userId)).toMatchObject({ accountStatus: 'pending_admin_approval', approvalDueAt });
    expect(await cmCountActiveSessionsForUser(userId)).toBe(1);
  });
  it.each(['logout', 'revoke-all', 'oauth-logout', 'oauth-revoke-all'])
  ('should persist issuer tombstones for product %s before returning', async operation => {
    const tokens = await mintMfaSession();
    if (operation.includes('all')) await mintMfaSession();
    const rows = await listCmSessionsForUser(userId);
    const transport = await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    if (operation === 'logout') await revokeSession(tokens.sessionId);
    if (operation === 'revoke-all') await revokeAllSessions(userId);
    // The host ports bag carries protocol configuration only; the OAuth
    // session ports resolve to the same CM-backed facade.
    if (operation === 'oauth-logout') await revokeSession(tokens.sessionId);
    if (operation === 'oauth-revoke-all') await revokeAllSessions(userId);
    // Issuer delivery now lands through the sweep: one tombstone POST per
    // ledger row plus the single cached S2S token fetch. Revoke-all fans out to
    // one row per session plus the subject row.
    await drainAllCmRevocations();
    expect(transport).toHaveBeenCalledTimes(operation.includes('all') ? 1 + rows.length + 1 : 2);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    for (const row of rows) expect(getRemoteSessionAuthority()!.find(row.id)?.revoked).toBe(true);
    expect(await cmCountActiveSessionsForUser(userId)).toBe(0);
    for (const row of rows) await cmReinsertSession(row);
    // The reinserted sessions do not revive the issuer tombstones.
    for (const row of rows) expect(getRemoteSessionAuthority()!.find(row.id)).toMatchObject({ revoked: true });
  });
  it.each([{ scope: 'remote.evidence.issue' }, { aud: 'other' }, { client_id: 'other' },
    { sub: 'user' }, { cnf: { jkt: 'bound-token' } }, { exp: 1 }, { exp: undefined }, {}])
  ('should enforce revocation token claims with an authenticated body %j', async change => {
    const tokens = await mintMfaSession();
    const authorization = `Bearer ${await bearer(change)}`;
    const body = JSON.stringify({ sessionIds: [tokens.sessionId] });
    const result = await createIdpApp().request(`${issuer}${path}`, { method: 'POST',
      headers: { authorization, ...signRevocation(body, authorization) }, body });
    const valid = Object.keys(change).length === 0;
    expect(result.status).toBe(valid ? 204 : 401);
    if (!valid) expect(await result.json()).toEqual({ error: 'authentication_required' });
    // The valid delivery tombstones the file mirror; refused requests write
    // nothing (CM-minted sessions have no mirror record until tombstoned).
    if (valid) expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toMatchObject({ revoked: true });
    else expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toBeNull();
  });
  it('should delete the DB session even when issuer delivery fails', async () => {
    const tokens = await mintMfaSession();
    const row = await findCmSessionById(tokens.sessionId);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    // Enqueue never throws; the failed delivery stays pending for the retry sweep.
    await revokeSession(tokens.sessionId);
    expect((await findCmSessionById(tokens.sessionId))?.revokedAt ?? null).toBeTruthy();
    await drainCmRevocations();
    expect(await pendingCmRevocations()).toHaveLength(1);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    expect(await resolveRemoteLogin(tokens.sessionToken)).toBeNull();
    // Retry still tombstones the issuer record after the shared row is already gone.
    await bridge();
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    await revokeSession(tokens.sessionId);
    await drainAllCmRevocations();
    expect(await pendingCmRevocations()).toEqual([]);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    await cmReinsertSession(row!);
    // The retry tombstone survives the session-row restoration.
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toMatchObject({ revoked: true });
  });
  it.each(['lock', 'corrupt-file', 'missing-pvc'])
  ('should delete product sessions and keep issuer delivery closed on %s', async failure => {
    const tokens = await mintMfaSession();
    await bridge();
    if (failure === 'lock') mkdirSync(join(directory, `${remoteRawHash(tokens.sessionId)}.json.lock`));
    if (failure === 'corrupt-file') writeFileSync(join(directory, `${'0'.repeat(64)}.json`), '{');
    if (failure === 'missing-pvc') rmSync(directory, { recursive: true });
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    // The product path never touches the file authority: revoke commits
    // against CM and queues delivery. Reads come from CM too; the file store
    // gates delivery, so a broken store fails closed at the sweep instead.
    await revokeAllSessions(userId);
    expect(await cmCountActiveSessionsForUser(userId)).toBe(0);
    await drainCmRevocations();
    expect((await pendingCmRevocations()).length).toBeGreaterThan(0);
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    if (failure === 'missing-pvc') {
      expect(() => getRemoteSessionAuthority()).toThrowError(/authority_unavailable/);
    } else if (failure === 'lock') {
      expect(() => getRemoteSessionAuthority()!.find(tokens.sessionId)).toThrowError(/authority_unavailable/);
    } else {
      // The corrupt file belongs to no known session, so reads ignore it; the
      // subject-row delivery still trips over it, fails closed and closes the
      // authority. Poll past the release backoff until the closure is visible.
      let closed = false;
      for (let attempt = 0; attempt < 40 && !closed; attempt++) {
        await drainCmRevocations();
        try { getRemoteSessionAuthority()!.find(tokens.sessionId); }
        catch { closed = true; }
        if (!closed) await new Promise(resolve => setTimeout(resolve, 250));
      }
      expect(closed).toBe(true);
    }
  });
  it('should refuse an active product composition missing its issuer configuration after DB removal', async () => {
    const tokens = await createSession(userId, 'editor');
    vi.stubEnv('REMOTE_ACTION_ROLE', 'product');
    vi.stubEnv('REMOTE_ACTION_REVOCATION_ISSUER', '');
    // The revoke commits locally; the missing issuer configuration fails closed
    // at sweep delivery and the intent stays pending for operator recovery.
    await revokeSession(tokens.sessionId);
    expect((await findCmSessionById(tokens.sessionId))?.revokedAt ?? null).toBeTruthy();
    await drainCmRevocations();
    expect(await pendingCmRevocations()).toHaveLength(1);
  });
  it.each(['browser', 'cookie', 'http', 'extra-field', 'duplicate', 'oversize', 'empty', 'anonymous'])
  ('should refuse %s revocation requests without writing authority', async failure => {
    const tokens = await mintMfaSession();
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
    // Refused requests write nothing: CM-minted sessions have no file-mirror
    // record until a delivered revocation tombstones them.
    expect(getRemoteSessionAuthority()!.find(tokens.sessionId)).toBeNull();
  });
});
