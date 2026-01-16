import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { contextDocuments, workspaceMemberships } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

const mockPutObject = vi.fn();
const mockDeleteObject = vi.fn();
const mockGetObjectBodyStream = vi.fn();

vi.mock('../../src/services/storage-s3', async () => {
  return {
    getDocumentsBucketName: () => 'test-bucket',
    putObject: (args: any) => mockPutObject(args),
    deleteObject: (args: any) => mockDeleteObject(args),
    getObjectBodyStream: (args: any) => mockGetObjectBodyStream(args),
  };
});

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Collaboration security', () => {
  let editor: any;
  let viewer: any;
  let otherEditor: any;
  let outsider: any;
  let workspaceId: string;

  beforeEach(async () => {
    editor = await createAuthenticatedUser('editor', `editor-${createTestId()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-${createTestId()}@example.com`);
    otherEditor = await createAuthenticatedUser('editor', `editor2-${createTestId()}@example.com`);
    outsider = await createAuthenticatedUser('editor', `outsider-${createTestId()}@example.com`);
    workspaceId = editor.workspaceId;

    await db
      .insert(workspaceMemberships)
      .values([
        { workspaceId, userId: viewer.id, role: 'viewer', createdAt: new Date() },
        { workspaceId, userId: otherEditor.id, role: 'editor', createdAt: new Date() },
      ])
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('returns 403 for viewer mutations', async () => {
    const orgRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/organizations?workspace_id=${encodeURIComponent(workspaceId)}`,
      viewer.sessionToken!,
      { name: `Org ${createTestId()}`, industry: 'Test' }
    );
    expect(orgRes.status).toBe(403);

    const folderRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
      viewer.sessionToken!,
      { name: `Folder ${createTestId()}`, description: 'Test' }
    );
    expect(folderRes.status).toBe(403);

    const useCaseRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/use-cases?workspace_id=${encodeURIComponent(workspaceId)}`,
      viewer.sessionToken!,
      { name: `UC ${createTestId()}`, description: 'Test', folderId: 'f_1' }
    );
    expect(useCaseRes.status).toBe(403);

    const lockRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/locks?workspace_id=${encodeURIComponent(workspaceId)}`,
      viewer.sessionToken!,
      { objectType: 'organization', objectId: `org_${createTestId()}` }
    );
    expect(lockRes.status).toBe(403);

    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'viewer.pdf', { type: 'application/pdf' }));
    const docRes = await app.request('/api/v1/documents', {
      method: 'POST',
      headers: { Cookie: `session=${viewer.sessionToken}` },
      body: form as any,
    });
    expect(docRes.status).toBe(403);
  });

  it('returns 403 for editor member management + workspace lifecycle', async () => {
    const hideRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${workspaceId}/hide`,
      editor.sessionToken!,
      {}
    );
    expect(hideRes.status).toBe(403);

    const addRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${workspaceId}/members`,
      editor.sessionToken!,
      { email: viewer.email, role: 'viewer' }
    );
    expect(addRes.status).toBe(403);

    const delRes = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/workspaces/${workspaceId}`,
      editor.sessionToken!
    );
    expect(delRes.status).toBe(403);
  });

  it('returns 404 for non-member workspace access', async () => {
    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/folders?workspace_id=${encodeURIComponent(workspaceId)}`,
      outsider.sessionToken!
    );
    expect(res.status).toBe(404);
  });

  it('rejects cross-workspace document access by id (404)', async () => {
    const docId = `doc_${createTestId()}`;
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      storageKey: `doc/${docId}`,
      status: 'uploaded',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/documents/${docId}?workspace_id=${encodeURIComponent(workspaceId)}`,
      outsider.sessionToken!
    );
    expect(res.status).toBe(404);

    await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
  });

  it('enforces concurrent edit locks per object type (409)', async () => {
    const objectTypes: Array<'organization' | 'folder' | 'usecase'> = ['organization', 'folder', 'usecase'];

    for (const objectType of objectTypes) {
      const objectId = `${objectType}_${createTestId()}`;
      const lockA = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/locks?workspace_id=${encodeURIComponent(workspaceId)}`,
        editor.sessionToken!,
        { objectType, objectId }
      );
      expect(lockA.status).toBe(201);

      const lockB = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/locks?workspace_id=${encodeURIComponent(workspaceId)}`,
        otherEditor.sessionToken!,
        { objectType, objectId }
      );
      expect(lockB.status).toBe(409);
    }
  });

});
