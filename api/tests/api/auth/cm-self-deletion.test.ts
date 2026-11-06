import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app';
import { createSession, validateSession } from '../../../src/services/session-manager';
import { findCmUserById, updateCmUser } from '../../../src/services/identity/cm-users';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';
import { cmQuery } from '../../utils/cm-identity-test-store';
import { Hono } from 'hono';
import { requireCmAccountAuth } from '../../../src/services/identity/cm-self-deletion';
import { accountRouter } from '../../../src/routes/namespaces/auth/cm-auth-hono';
import { refreshSession } from '../../../src/services/session-manager';
import { cmIdentityUnitOfWork } from '../../../src/services/identity/cm-transaction';

describe('self-deletion continuation authority', () => {
  afterEach(async () => { vi.restoreAllMocks(); await cleanupAuthData(); });

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

  it('refuses deactivation after the authenticated credential rotates, before any mutation', async () => {
    const user = await createAuthenticatedUser('editor');
    const original = await createSession(user.id, 'editor');
    let rotated: Awaited<ReturnType<typeof refreshSession>>;
    const raced = new Hono().use('*', requireCmAccountAuth).use('*', async (_c, next) => {
      rotated = await refreshSession(original.refreshToken);
      await next();
    }).route('/account', accountRouter);
    expect((await authenticatedRequest(raced, 'POST', '/account/deactivate', original.sessionToken, {})).status).toBe(401);
    expect(await findCmUserById(user.id)).toMatchObject({ accountStatus: 'active' });
    expect(await validateSession(rotated!.sessionToken)).toMatchObject({ userId: user.id });
    expect(await cmQuery("SELECT jti FROM public.oauth_dpop_proofs WHERE starts_with(jti, 'self-delete:' || $1 || ':')", [user.id])).toEqual([]);
  });

  it('refuses an admitted active DELETE after another session deactivates the account', async () => {
    const user = await createAuthenticatedUser('editor');
    const other = await createSession(user.id, 'editor');
    const raced = new Hono().use('*', requireCmAccountAuth).use('*', async (_c, next) => {
      expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', other.sessionToken, {})).status).toBe(200);
      await next();
    }).route('/account', accountRouter);
    expect((await authenticatedRequest(raced, 'DELETE', '/account', user.sessionToken!)).status).toBe(403);
    expect(await findCmUserById(user.id)).toMatchObject({ accountStatus: 'disabled_by_user' });
    expect((await authenticatedRequest(app, 'DELETE', '/api/v1/me', other.sessionToken)).status).toBe(200);
  });

  it('revalidates continuation expiry after HTTP admission and before V2 reservation', async () => {
    const user = await createAuthenticatedUser('editor');
    expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', user.sessionToken!, {})).status).toBe(200);
    const raced = new Hono().use('*', requireCmAccountAuth).use('*', async (_c, next) => {
      await cmQuery("UPDATE public.oauth_dpop_proofs SET expires_at = $2 WHERE starts_with(jti, 'self-delete:' || $1 || ':')",
        [user.id, new Date(0).toISOString()]);
      await next();
    }).route('/account', accountRouter);
    expect((await authenticatedRequest(raced, 'DELETE', '/account', user.sessionToken!)).status).toBe(403);
    expect(await findCmUserById(user.id)).not.toBeNull();
  });

  it('revalidates the continuation again between V2 reservation and destructive commit', async () => {
    const user = await createAuthenticatedUser('editor');
    expect((await authenticatedRequest(app, 'POST', '/api/v1/me/deactivate', user.sessionToken!, {})).status).toBe(200);
    const run = cmIdentityUnitOfWork.run.bind(cmIdentityUnitOfWork);
    let reservations = 0;
    vi.spyOn(cmIdentityUnitOfWork, 'run').mockImplementation(async (options, operation) => {
      const result = await run(options, operation);
      if (options.purpose === 'delete' && options.mode === 'write' && ++reservations === 1) {
        await cmQuery("UPDATE public.oauth_dpop_proofs SET expires_at = $2 WHERE starts_with(jti, 'self-delete:' || $1 || ':')",
          [user.id, new Date(0).toISOString()]);
      }
      return result;
    });
    const response = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, complete: false, resultCode: 'identity_cascade_rolled_back' });
    expect(await findCmUserById(user.id)).toMatchObject({ accountStatus: 'disabled_by_user' });
  });
});
