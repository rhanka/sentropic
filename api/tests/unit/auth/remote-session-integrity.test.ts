import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { cmDeleteForUsers, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { createSession, refreshSession } from '../../../src/services/session-manager';

let userId: string;
beforeEach(async () => {
  userId = crypto.randomUUID();
  await createCmUser({ userId, email: `rc1-integrity-${userId}@example.test`, role: 'editor', emailVerified: true, accountStatus: 'active' });
});
afterEach(async () => { await cmDeleteForUsers([userId]); });
// Post-cutover the facade refuses self-asserted MFA (see session-manager.test.ts);
// MFA sessions are minted through the binding, the same issuance call the verified
// authentication ceremony makes.
const mintMfaSession = () => withAppCmAuth(runner => runner.request(async binding => {
  const user = await binding.ports.users.findById(userId);
  if (!user) throw new Error('missing integrity fixture user');
  return binding.sessions.createSession({ user, mfaVerified: true });
}));
describe('RC1 issuer login integrity against product DB mutation', () => {
  it('should sign immutable MFA and lineage in both session and refresh credentials', async () => {
    const tokens = await mintMfaSession();
    const access = decodeJwt(tokens.sessionToken);
    const refresh = decodeJwt(tokens.refreshToken);
    expect(access.login).toMatchObject({ mfaVerified: true });
    expect(refresh.login).toEqual(access.login);
    expect(refresh.tokenUse).toBe('refresh');
  });
  it('should refuse refresh when DB writers elevate a single-factor login to MFA', async () => {
    const tokens = await createSession(userId, 'editor');
    await cmQuery(`UPDATE ${cmTable('identity_login_sessions')} SET "mfa_state" = 'step_up' WHERE "session_id" = $1`, [tokens.sessionId]);
    await cmQuery(`UPDATE ${cmTable('identity_login_token_bindings')} SET "mfa_verified" = TRUE WHERE "session_id" = $1`, [tokens.sessionId]);
    expect(await refreshSession(tokens.refreshToken)).toBeNull();
  });
  it('should preserve signed login lineage across refresh and refuse a changed DB version', async () => {
    const tokens = await mintMfaSession();
    const current = (await refreshSession(tokens.refreshToken))!;
    expect(decodeJwt(current.sessionToken).login).toEqual(decodeJwt(tokens.sessionToken).login);
    await cmQuery(`UPDATE ${cmTable('identity_login_token_bindings')} SET "session_version" = $1 WHERE "session_id" = $2`, [0, tokens.sessionId]);
    expect(await refreshSession(current.refreshToken)).toBeNull();
  });
});
