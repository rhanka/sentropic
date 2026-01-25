import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { workspaceMemberships } from '../../src/db/schema';

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

describe('Locks API', () => {
  let app: any;
  let userA: any;
  let userB: any;
  let viewer: any;
  let workspaceId: string;

  beforeEach(async () => {
    app = await importApp();
    userA = await createAuthenticatedUser('editor', 'usera@example.com');
    userB = await createAuthenticatedUser('editor', 'userb@example.com');
    viewer = await createAuthenticatedUser('viewer', 'viewer@example.com');
    workspaceId = userA.workspaceId;

    await db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: userB.id, role: 'editor', createdAt: new Date() })
      .onConflictDoNothing();
    await db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: viewer.id, role: 'viewer', createdAt: new Date() })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('returns 409 when the object is already locked by another user', async () => {
    const body = { objectType: 'organization', objectId: 'org-1' };

    const resA = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks?workspace_id=${workspaceId}`,
      userA.sessionToken,
      body
    );
    expect(resA.status).toBe(201);

    const resB = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks?workspace_id=${workspaceId}`,
      userB.sessionToken,
      body
    );
    expect(resB.status).toBe(409);
  });

  it('rejects lock acquisition for viewer role', async () => {
    const body = { objectType: 'organization', objectId: 'org-viewer' };
    const res = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks?workspace_id=${workspaceId}`,
      viewer.sessionToken,
      body
    );
    expect(res.status).toBe(403);
  });

  it('transfers lock to requester when unlock is accepted', async () => {
    const body = { objectType: 'organization', objectId: 'org-2' };

    const resA = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks?workspace_id=${workspaceId}`,
      userA.sessionToken,
      body
    );
    expect(resA.status).toBe(201);

    const reqUnlock = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks/request-unlock?workspace_id=${workspaceId}`,
      userB.sessionToken,
      body
    );
    expect(reqUnlock.status).toBe(200);

    const accept = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks/accept-unlock?workspace_id=${workspaceId}`,
      userA.sessionToken,
      body
    );
    expect(accept.status).toBe(200);

    const getLock = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/locks?workspace_id=${workspaceId}&objectType=organization&objectId=org-2`,
      userB.sessionToken
    );
    expect(getLock.status).toBe(200);
    const payload = await getLock.json();
    expect(payload.lock?.lockedBy?.userId).toBe(userB.id);
  });

  it('scopes presence per workspace', async () => {
    const body = { objectType: 'organization', objectId: 'org-3' };

    const record = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks/presence?workspace_id=${userB.workspaceId}`,
      userB.sessionToken,
      body
    );
    expect(record.status).toBe(200);

    const listA = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/locks/presence?workspace_id=${userA.workspaceId}&objectType=organization&objectId=org-3`,
      userA.sessionToken
    );
    expect(listA.status).toBe(200);
    const listAJson = await listA.json();
    expect(listAJson.total).toBe(0);

    const listB = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/locks/presence?workspace_id=${userB.workspaceId}&objectType=organization&objectId=org-3`,
      userB.sessionToken
    );
    expect(listB.status).toBe(200);
    const listBJson = await listB.json();
    expect(listBJson.total).toBe(1);
    expect(listBJson.users?.[0]?.userId).toBe(userB.id);
  });
});
