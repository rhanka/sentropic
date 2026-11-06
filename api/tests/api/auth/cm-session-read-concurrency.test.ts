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

  it('keeps same-session reads available and records activity', async () => {
    const user = await createAuthenticatedUser('editor');
    const before = new Date().toISOString();
    const responses = await Promise.all(Array.from({ length: concurrentReads }, () => readSession(user.sessionToken)));
    expect(responses.map(response => response.status)).toEqual(Array(concurrentReads).fill(200));
    const sessions = await Promise.all(responses.map(response => response.json()));
    for (const session of sessions) {
      expect(session).toMatchObject({ userId: user.id, sessionId: sessions[0].sessionId, role: 'editor' });
    }
    const rows = await cmQuery<{ last_activity_at: string }>(
      'SELECT last_activity_at FROM cm_identity.identity_login_token_bindings WHERE session_id = $1',
      [sessions[0].sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_activity_at >= before).toBe(true);
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
