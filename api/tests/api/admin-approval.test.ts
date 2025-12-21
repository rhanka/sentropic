import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { users, userSessions } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Admin approval API', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should allow admin_app to list users', async () => {
    const admin = await createAuthenticatedUser('admin_app');
    const editor = await createAuthenticatedUser('editor');

    // mark editor as pending approval
    await db.update(users).set({
      accountStatus: 'pending_admin_approval',
      approvalDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(users.id, editor.id));

    const res = await authenticatedRequest(app, 'GET', '/api/v1/admin/users?status=pending_admin_approval', admin.sessionToken!);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('should allow admin_app to approve a pending user and revoke sessions', async () => {
    const admin = await createAuthenticatedUser('admin_app');
    const u = await createAuthenticatedUser('editor');

    await db.update(users).set({
      accountStatus: 'pending_admin_approval',
      approvalDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(users.id, u.id));

    const approve = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${u.id}/approve`,
      admin.sessionToken!,
      { role: 'editor' }
    );
    expect(approve.status).toBe(200);

    const [updated] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    expect(updated.accountStatus).toBe('active');
    expect(updated.approvedAt).toBeInstanceOf(Date);
    expect(updated.approvedByUserId).toBe(admin.id);

    const sessions = await db.select().from(userSessions).where(eq(userSessions.userId, u.id));
    expect(sessions.length).toBe(0);
  });

  it('should allow admin_app to disable and reactivate a user', async () => {
    const admin = await createAuthenticatedUser('admin_app');
    const u = await createAuthenticatedUser('editor');

    const disable = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${u.id}/disable`,
      admin.sessionToken!,
      { reason: 'test' }
    );
    expect(disable.status).toBe(200);

    const [disabled] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    expect(disabled.accountStatus).toBe('disabled_by_admin');
    expect(disabled.disabledAt).toBeInstanceOf(Date);
    expect(disabled.disabledReason).toBe('test');

    const reactivate = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${u.id}/reactivate`,
      admin.sessionToken!
    );
    expect(reactivate.status).toBe(200);

    const [reactivated] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    expect(reactivated.accountStatus).toBe('active');
  });
});


