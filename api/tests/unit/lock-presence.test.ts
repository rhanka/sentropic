import { describe, it, expect, afterEach } from 'vitest';
import { recordPresence, listPresence, removePresence } from '../../src/services/lock-presence';
import { createTestUser, cleanupAuthData } from '../utils/auth-helper';

describe('lock-presence', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('records and lists presence with display data', async () => {
    const user = await createTestUser({ role: 'editor', withSession: false, displayName: 'Alice Presence' });
    const workspaceId = user.workspaceId!;
    const objectType = 'organization';
    const objectId = `org_${Date.now()}`;

    const snapshot = await recordPresence({
      workspaceId,
      objectType,
      objectId,
      user: { userId: user.id, email: null, displayName: null },
    });

    expect(snapshot.total).toBe(1);
    expect(snapshot.users[0]?.userId).toBe(user.id);

    const listed = listPresence({ workspaceId, objectType, objectId });
    expect(listed.total).toBe(1);
    expect(listed.users[0]?.userId).toBe(user.id);
  });

  it('removes presence for a user', async () => {
    const user = await createTestUser({ role: 'editor', withSession: false });
    const workspaceId = user.workspaceId!;
    const objectType = 'folder';
    const objectId = `folder_${Date.now()}`;

    await recordPresence({
      workspaceId,
      objectType,
      objectId,
      user: { userId: user.id, email: user.email, displayName: user.displayName },
    });

    const removed = await removePresence({
      workspaceId,
      objectType,
      objectId,
      userId: user.id,
    });
    expect(removed.total).toBe(0);
  });
});
