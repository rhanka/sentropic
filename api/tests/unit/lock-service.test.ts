import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/client';
import { objectLocks, workspaceMemberships } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestUser, cleanupAuthData } from '../utils/auth-helper';
import { acquireLock, releaseLock, requestUnlock, acceptUnlock, forceUnlock, getActiveLock, __test_clearLocksForUser } from '../../src/services/lock-service';

describe('lock-service', () => {
  let editor: any;
  let editorB: any;
  let adminMember: any;
  let workspaceId: string;

  beforeEach(async () => {
    const suffix = Date.now();
    editor = await createTestUser({ role: 'editor', withSession: false, email: `editor-${suffix}@example.com` });
    editorB = await createTestUser({ role: 'editor', withSession: false, email: `editorb-${suffix}@example.com` });
    adminMember = await createTestUser({ role: 'editor', withSession: false, email: `admin-${suffix}@example.com` });
    workspaceId = editor.workspaceId;

    await db
      .insert(workspaceMemberships)
      .values([
        { workspaceId, userId: editorB.id, role: 'editor', createdAt: new Date() },
        { workspaceId, userId: adminMember.id, role: 'admin', createdAt: new Date() },
      ])
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await db.delete(objectLocks);
    await cleanupAuthData();
  });

  it('acquire/release flow works and blocks second editor', async () => {
    const objectType = 'organization';
    const objectId = `org_${Date.now()}`;

    const first = await acquireLock({ userId: editor.id, workspaceId, objectType, objectId });
    expect(first.acquired).toBe(true);

    const conflict = await acquireLock({ userId: editorB.id, workspaceId, objectType, objectId });
    expect(conflict.acquired).toBe(false);

    const released = await releaseLock({ userId: editor.id, workspaceId, objectType, objectId });
    expect(released.released).toBe(true);
  });

  it('request/accept unlock transfers ownership', async () => {
    const objectType = 'folder';
    const objectId = `folder_${Date.now()}`;

    await acquireLock({ userId: editor.id, workspaceId, objectType, objectId });
    const req = await requestUnlock({ userId: editorB.id, workspaceId, objectType, objectId });
    expect(req.requested).toBe(true);

    const accepted = await acceptUnlock({ userId: editor.id, workspaceId, objectType, objectId });
    expect(accepted.accepted).toBe(true);
    const lock = await getActiveLock(workspaceId, objectType, objectId);
    expect(lock?.lockedBy.userId).toBe(editorB.id);
  });

  it('forceUnlock requires admin workspace role', async () => {
    const objectType = 'usecase';
    const objectId = `usecase_${Date.now()}`;
    await acquireLock({ userId: editor.id, workspaceId, objectType, objectId });

    await expect(
      forceUnlock({ userId: editorB.id, workspaceId, objectType, objectId })
    ).rejects.toThrow('Insufficient permissions');

    const forced = await forceUnlock({ userId: adminMember.id, workspaceId, objectType, objectId });
    expect(forced.forced).toBe(true);
  });

  it('getActiveLock returns null for expired locks', async () => {
    const objectType = 'organization';
    const objectId = `org_expired_${Date.now()}`;
    await db.insert(objectLocks).values({
      id: `lock_${Date.now()}`,
      workspaceId,
      objectType,
      objectId,
      lockedByUserId: editor.id,
      lockedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });

    const lock = await getActiveLock(workspaceId, objectType, objectId);
    expect(lock).toBeNull();
  });

  it('clears locks for a user (zero SSE connections)', async () => {
    const objectType = 'organization';
    const objectId = `org_clear_${Date.now()}`;
    await acquireLock({ userId: editor.id, workspaceId, objectType, objectId });

    await __test_clearLocksForUser(editor.id);

    const lock = await getActiveLock(workspaceId, objectType, objectId);
    expect(lock).toBeNull();
  });
});
