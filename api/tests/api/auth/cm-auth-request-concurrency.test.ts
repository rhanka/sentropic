import { afterEach, describe, expect, it } from 'vitest';
import { authenticateCmHttpRequest } from '../../../src/services/identity/cm-http-principal';
import { createAuthenticatedUser, cleanupAuthData } from '../../utils/auth-helper';
import { cmQuery } from '../../utils/cm-identity-test-store';

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
    await cleanupAuthData();
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
});
