import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { cmDeleteForUsers, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { createSession, refreshSession } from '../../../src/services/session-manager';

let userId: string;
beforeEach(async () => {
  userId = crypto.randomUUID();
  await createCmUser({ userId, email: `rc1-integrity-${userId}@example.test`, role: 'editor', emailVerified: true, accountStatus: 'active' });
});
afterEach(async () => { await cmDeleteForUsers([userId]); });
describe('RC1 issuer login integrity against product DB mutation', () => {
  it('should sign immutable MFA and lineage in both session and refresh credentials', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const access = decodeJwt(tokens.sessionToken);
    const refresh = decodeJwt(tokens.refreshToken);
    expect(access.login).toMatchObject({ mfaVerified: true });
    expect(refresh.login).toEqual(access.login);
    expect(refresh.tokenUse).toBe('refresh');
  });
  it('should refuse refresh when DB writers elevate a single-factor login to MFA', async () => {
    const tokens = await createSession(userId, 'editor');
    await cmQuery(`UPDATE ${cmTable('identity_login_sessions')} SET "mfa_state" = 'step_up' WHERE "session_id" = $1`, [tokens.sessionId]);
    await cmQuery(`UPDATE ${cmTable('identity_login_token_bindings')} SET "mfa_verified" = 1 WHERE "session_id" = $1`, [tokens.sessionId]);
    expect(await refreshSession(tokens.refreshToken)).toBeNull();
  });
  it('should preserve signed login lineage across refresh and refuse a changed DB version', async () => {
    const tokens = await createSession(userId, 'editor', undefined, { mfaVerified: true });
    const current = (await refreshSession(tokens.refreshToken))!;
    expect(decodeJwt(current.sessionToken).login).toEqual(decodeJwt(tokens.sessionToken).login);
    await cmQuery(`UPDATE ${cmTable('identity_login_sessions')} SET "created_at" = $1 WHERE "session_id" = $2`, [new Date(0).toISOString(), tokens.sessionId]);
    expect(await refreshSession(current.refreshToken)).toBeNull();
  });
});
