import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app';
import { createSession, validateSession } from '../../../src/services/session-manager';
import { findCmUserById, updateCmUser } from '../../../src/services/identity/cm-users';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';
import { cmQuery } from '../../utils/cm-identity-test-store';

describe('self-deletion continuation authority', () => {
  afterEach(cleanupAuthData);

  it('authorizes only deletion with the credential that initiated self-deactivation', async () => {
    const user = await createAuthenticatedUser('editor');
    const other = await createSession(user.id, 'editor');
    expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', user.sessionToken!, {})).status).toBe(200);
    expect(await validateSession(user.sessionToken!)).toBeNull();
    expect(await validateSession(other.sessionToken)).toBeNull();
    expect((await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!)).status).toBe(401);
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', other.sessionToken)).status).toBe(401);
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', `${user.sessionToken!}invalid`)).status).toBe(401);
    expect(await findCmUserById(user.id)).not.toBeNull();
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!)).status).toBe(200);
    expect(await findCmUserById(user.id)).toBeNull();
  });

  it('refuses an expired deletion continuation without deleting the account', async () => {
    const user = await createAuthenticatedUser('editor');
    expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', user.sessionToken!, {})).status).toBe(200);
    await cmQuery("UPDATE public.oauth_dpop_proofs SET expires_at = $2 WHERE split_part(jti, ':', 2) = $1",
      [user.id, new Date(0).toISOString()]);
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!)).status).toBe(401);
    expect(await findCmUserById(user.id)).toMatchObject({ accountStatus: 'disabled_by_user' });
  });

  it('refuses a disabled-by-admin account even with a previously issued self-deletion continuation', async () => {
    const user = await createAuthenticatedUser('editor');
    expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', user.sessionToken!, {})).status).toBe(200);
    await updateCmUser(user.id, { accountStatus: 'disabled_by_admin' });
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!)).status).toBe(401);
    expect(await findCmUserById(user.id)).not.toBeNull();
  });

  it('refuses active deletion without mutating account or login authority', async () => {
    const user = await createAuthenticatedUser('editor');
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!)).status).toBe(409);
    expect(await findCmUserById(user.id)).toMatchObject({ accountStatus: 'active' });
    expect(await validateSession(user.sessionToken!)).toMatchObject({ userId: user.id });
  });
});
