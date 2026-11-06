import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateCmHttpRequest } from '../../../src/services/identity/cm-http-principal';
import { createAuthenticatedUser, cleanupAuthData } from '../../utils/auth-helper';
import { cmQuery } from '../../utils/cm-identity-test-store';
import { Hono } from 'hono';
import { requireAuth } from '../../../src/middleware/auth';
import { randomUUID } from 'node:crypto';
import { createCmUser, findCmUserByEmail, findCmUserById } from '../../../src/services/identity/cm-users';
import { cmDeleteForEmails, cmDeleteForUsers } from '../../utils/cm-identity-test-store';
import { cmMagicLinkHandlers } from '../../../src/routes/namespaces/auth/cm-magic-link';
import { createCmMagicLink, sha256Hex } from '../../../src/services/identity/cm-proofs';
import { runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { sessionLifecycleHandlers } from '../../../src/routes/namespaces/session-lifecycle';
import { revokeSession } from '../../../src/services/session-manager';
import { app } from '../../../src/app';
import { cmIdentityUnitOfWork } from '../../../src/services/identity/cm-transaction';
import { db } from '../../../src/db/client';
import { workspaces } from '../../../src/db/schema';
import { eq, inArray } from 'drizzle-orm';

/**
 * A4 e2e residue (run 42032530355): every authenticated page load fans out
 * 6+ parallel GETs sharing one session (workspaces/me/catalog/agent-config/
 * workflow-config/sse). Each request ran a SERIALIZABLE write transaction
 * that updated the same login-token-binding row, so parallel requests
 * aborted each other with 40001 and the retries exhausted into HTTP 500s
 * ('Authentication failed'). Authentication is a read-only decision and
 * must stay available under that fan-out.
 */
describe('CM per-request authentication under same-session fan-out', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupAuthData();
  });

  it('completes concurrent new-account magic links without exhausting transaction attempts', async () => {
    const app = new Hono();
    app.post('/api/v1/auth/magic-link/verify', cmMagicLinkHandlers.verifyMagicLink!);
    const links = Array.from({ length: 16 }, () => {
      const token = randomUUID();
      return { token, email: `${randomUUID()}@example.test` };
    });
    try {
      for (const link of links) {
        await runCmIdentityWrite(() => createCmMagicLink({ email: link.email,
          tokenHash: sha256Hex(link.token), now: new Date(), expiresAt: new Date(Date.now() + 600_000) }));
      }
      const verify = (token: string) => app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://localhost:5670' },
        body: JSON.stringify({ token }),
      });
      const responses = await Promise.all(links.map(link => verify(link.token)));
      expect(responses.map(response => response.status)).toEqual(links.map(() => 200));
      for (const response of responses) expect((await response.json()).sessionToken).toBeTruthy();
      const accounts = await cmQuery<{ user_id: string }>(
        'SELECT user_id FROM cm_identity.identity_user_accounts WHERE email = ANY($1)',
        [links.map(link => link.email)],
      );
      expect(accounts).toHaveLength(links.length);
      const members = await cmQuery<{ user_id: string }>(
        "SELECT user_id FROM cm_identity.cm_workspace_members WHERE user_id = ANY($1) AND role = 'admin'",
        [accounts.map(account => account.user_id)],
      );
      expect(members).toHaveLength(links.length);
      expect((await verify(links[0].token)).status).toBe(400);
    } finally {
      const accounts = await cmQuery<{ user_id: string }>(
        'SELECT user_id FROM cm_identity.identity_user_accounts WHERE email = ANY($1)',
        [links.map(link => link.email)],
      );
      await cmDeleteForEmails(links.map(link => link.email));
      await cmDeleteForUsers(accounts.map(account => account.user_id));
    }
  });

  it('keeps session info available when an activity write would abort every attempt', async () => {
    const user = await createAuthenticatedUser('editor');
    const run = cmIdentityUnitOfWork.run.bind(cmIdentityUnitOfWork);
    const touched = vi.fn(async () => { throw Object.assign(new Error('forced activity conflict'), { code: '40001' }); });
    vi.spyOn(cmIdentityUnitOfWork, 'run').mockImplementation((options, operation) => run(options, async tx => {
      const touch = vi.spyOn(tx.custody.sessions, 'touchActivity').mockImplementation(touched);
      try { return await operation(tx); }
      finally { touch.mockRestore(); }
    }));
    const response = await app.request('/api/v1/auth/session', { headers: { cookie: `session=${user.sessionToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId: user.id });
    expect(touched).not.toHaveBeenCalled();
  });

  it('provisions distinct magic-link accounts concurrently within the existing attempt budget', async () => {
    const registrations = Array.from({ length: 16 }, () => ({ email: `${randomUUID()}@example.test`, token: randomUUID() }));
    const emails = registrations.map(registration => registration.email);
    try {
      for (const registration of registrations) await createCmMagicLink({ email: registration.email,
        tokenHash: sha256Hex(registration.token), now: new Date(), expiresAt: new Date(Date.now() + 60_000) });
      const responses = await Promise.all(registrations.map(registration => app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: registration.token }),
      })));
      expect(responses.map(response => response.status)).toEqual(registrations.map(() => 200));
      for (let index = 0; index < registrations.length; index += 1) {
        const registration = registrations[index];
        const account = await findCmUserByEmail(registration.email);
        expect(account).toMatchObject({ email: registration.email, emailVerified: true });
        const issued = await responses[index].json();
        const current = await app.request('/api/v1/auth/session', { headers: { cookie: `session=${issued.sessionToken}` } });
        expect(current.status).toBe(200);
        expect(await current.json()).toMatchObject({ userId: account!.id });
        expect(await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.ownerUserId, account!.id))).toHaveLength(1);
        const replay = await app.request('/api/v1/auth/magic-link/verify', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: registration.token }) });
        expect(replay.status).toBe(400);
        expect(replay.headers.get('set-cookie')).toBeNull();
      }
    } finally {
      const accounts = await Promise.all(emails.map(findCmUserByEmail));
      const ids = accounts.flatMap(account => account ? [account.id] : []);
      if (ids.length) {
        const owned = await db.delete(workspaces).where(inArray(workspaces.ownerUserId, ids)).returning({ id: workspaces.id });
        await cmDeleteForUsers(ids);
        await cmQuery('DELETE FROM "cm_identity"."cm_workspaces" WHERE workspace_id = ANY($1::text[])', [owned.map(row => row.id)]);
      }
      await cmDeleteForEmails(emails);
    }
  });

  it('registers distinct accounts concurrently without exhausting transaction attempts', async () => {
    const users = Array.from({ length: 16 }, () => {
      const userId = randomUUID();
      return { userId, email: `${userId}@example.test`, role: 'editor', emailVerified: true };
    });
    try {
      const results = await Promise.allSettled(users.map(user => createCmUser(user)));
      expect(results.filter(result => result.status === 'rejected')).toEqual([]);
      for (const user of users) expect(await findCmUserById(user.userId)).toMatchObject({ id: user.userId, email: user.email });
    } finally {
      await cmDeleteForEmails(users.map(user => user.email));
      await cmDeleteForUsers(users.map(user => user.userId));
    }
  });

  it('projects presence identity from the validated CM user rather than JWT claims', async () => {
    const user = await createAuthenticatedUser('editor');
    const app = new Hono();
    app.use('/presence-principal', requireAuth);
    app.get('/presence-principal', context => context.json(context.get('user')));
    const response = await app.request('/presence-principal', { headers: { cookie: `session=${user.sessionToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId: user.id, email: user.email, displayName: user.displayName });
  });

  it('accepts concurrent same-session authentications without throwing', async () => {
    const user = await createAuthenticatedUser('editor');
    const cookie = `session=${user.sessionToken}`;
    const before = new Date().toISOString();

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        authenticateCmHttpRequest(
          new Request('http://cm.local/authentication', { headers: { cookie } }),
          true,
        ),
      ),
    );

    expect(results.length).toBe(12);
    for (const result of results) {
      expect(result.accepted).toBe(true);
      if (result.accepted) expect(result.principal?.session.sessionId).toBeTruthy();
    }

    const sessionId = results[0].accepted ? results[0].principal?.session.sessionId : null;
    expect(sessionId).toBeTruthy();
    const rows = await cmQuery<{ last_activity_at: string }>(
      'SELECT last_activity_at FROM "cm_identity"."identity_login_token_bindings" WHERE session_id = $1',
      [sessionId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].last_activity_at >= before).toBe(true);
  });

  it('serves concurrent current-session requests and still refuses invalid or revoked sessions', async () => {
    const user = await createAuthenticatedUser('editor');
    const sessionToken = user.sessionToken!;
    const activity = '2026-01-01T00:00:00.000Z';
    await cmQuery('UPDATE cm_identity.identity_login_token_bindings SET last_activity_at = $2 WHERE session_id IN (SELECT session_id FROM cm_identity.identity_login_sessions WHERE user_id = $1)', [user.id, activity]);
    const app = new Hono();
    app.get('/api/v1/auth/session', sessionLifecycleHandlers.current!);
    const request = (token: string) => app.request('/api/v1/auth/session', {
      headers: { cookie: `session=${token}` },
    });
    const responses = await Promise.all(Array.from({ length: 16 }, () => request(sessionToken)));
    expect(responses.map(response => response.status)).toEqual(Array(16).fill(200));
    let sessionId = '';
    for (const response of responses) {
      const body = await response.json();
      expect(body).toMatchObject({ userId: user.id, role: user.role });
      sessionId = body.sessionId;
      expect(sessionId).toBeTruthy();
    }
    // A session-info read must not contend on activity writes with page loads.
    const activityRows = await cmQuery<{ unchanged: boolean }>(
      'SELECT last_activity_at = $2 AS unchanged FROM cm_identity.identity_login_token_bindings WHERE session_id = $1',
      [sessionId, activity],
    );
    expect(activityRows).toEqual([{ unchanged: true }]);
    expect((await request('invalid-session')).status).toBe(401);
    await revokeSession(sessionId);
    expect((await request(sessionToken)).status).toBe(401);
  });
});
