import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sessionLifecycleHandlers } from '../../../src/routes/namespaces/session-lifecycle';
import { revokeSession } from '../../../src/services/session-manager';
import { cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';
import { cmQuery } from '../../utils/cm-identity-test-store';

const app = new Hono();
const concurrentReads = 64;
app.get('/api/v1/auth/session', sessionLifecycleHandlers.current!);
const readSession = (token: string) => app.request('/api/v1/auth/session', {
  headers: { cookie: `session=${token}` },
});

describe('CM session reads during concurrent page loads', () => {
  afterEach(async () => { await cleanupAuthData(); });

  it('keeps same-session reads available without changing activity', async () => {
    const user = await createAuthenticatedUser('editor');
    const activity = '2026-01-01T00:00:00.000Z';
    await cmQuery('UPDATE cm_identity.identity_login_token_bindings SET last_activity_at = $2 WHERE session_id IN (SELECT session_id FROM cm_identity.identity_login_sessions WHERE user_id = $1)', [user.id, activity]);
    const responses = await Promise.all(Array.from({ length: concurrentReads }, () => readSession(user.sessionToken)));
    expect(responses.map(response => response.status)).toEqual(Array(concurrentReads).fill(200));
    const sessions = await Promise.all(responses.map(response => response.json()));
    for (const session of sessions) {
      expect(session).toMatchObject({ userId: user.id, sessionId: sessions[0].sessionId, role: 'editor' });
    }
    const rows = await cmQuery<{ unchanged: boolean }>(
      'SELECT last_activity_at = $2 AS unchanged FROM cm_identity.identity_login_token_bindings WHERE session_id = $1',
      [sessions[0].sessionId, activity],
    );
    expect(rows).toEqual([{ unchanged: true }]);
  });

  it('still refuses invalid and revoked sessions', async () => {
    expect((await readSession('invalid-token')).status).toBe(401);
    const user = await createAuthenticatedUser('editor');
    const response = await readSession(user.sessionToken);
    expect(response.status).toBe(200);
    await revokeSession((await response.json()).sessionId);
    expect((await readSession(user.sessionToken)).status).toBe(401);
  });
});
