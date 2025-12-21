import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { companies, folders, useCases, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';

describe('Me API', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should return current user + workspace', async () => {
    const user = await createAuthenticatedUser('editor');
    const res = await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBe(user.id);
    expect(data.workspace.id).toBeDefined();
  });

  it('should allow toggling shareWithAdmin', async () => {
    const user = await createAuthenticatedUser('editor');
    const res = await authenticatedRequest(app, 'PATCH', '/api/v1/me', user.sessionToken!, { shareWithAdmin: true });
    expect(res.status).toBe(200);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id)).limit(1);
    expect(ws.shareWithAdmin).toBe(true);
  });

  it('should delete user workspace data on DELETE /me', async () => {
    const user = await createAuthenticatedUser('editor');

    // Trigger auth middleware which ensures workspace exists
    const meRes = await authenticatedRequest(app, 'GET', '/api/v1/me', user.sessionToken!);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    const wsId = meData.workspace.id as string;

    const companyId = createTestId();
    const folderId = createTestId();
    const useCaseId = createTestId();

    await db.insert(companies).values({ id: companyId, workspaceId: wsId, name: `C ${createTestId()}` });
    await db.insert(folders).values({ id: folderId, workspaceId: wsId, name: `F ${createTestId()}`, status: 'completed' });
    await db.insert(useCases).values({ id: useCaseId, workspaceId: wsId, folderId, data: { name: 'UC' } as any, status: 'completed' });

    const del = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(del.status).toBe(200);

    const remainingCompanies = await db.select().from(companies).where(eq(companies.id, companyId));
    expect(remainingCompanies.length).toBe(0);
  });
});


