import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAuthenticatedUser, cleanupAuthData, authenticatedRequest } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { contextDocuments, jobQueue, workspaces, workspaceMemberships } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';

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

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

async function authenticatedMultipartRequest(app: any, path: string, sessionToken: string, form: FormData) {
  return app.request(path, {
    method: 'POST',
    headers: {
      Cookie: `session=${sessionToken}`,
    },
    body: form as any,
  });
}

describe('Documents API', () => {
  let user: any;
  let admin: any;
  let viewer: any;
  let app: any;
  let createdDocId: string | null = null;
  let createdJobId: string | null = null;
  let addJobSpy: any;

  beforeEach(async () => {
    app = await importApp();
    user = await createAuthenticatedUser('editor');
    admin = await createAuthenticatedUser('admin_app');
    viewer = await createAuthenticatedUser('guest');
    mockPutObject.mockReset();
    mockDeleteObject.mockReset();
    mockGetObjectBodyStream.mockReset();
    createdJobId = null;
    createdDocId = null;

    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({
          workspaceId: user.workspaceId,
          userId: viewer.id,
          role: 'viewer',
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }

    // Spy queueManager.addJob so we can:
    // - create a real row in job_queue (FK on context_documents.job_id)
    // - keep the router behavior intact
    const qm = await import('../../src/services/queue-manager');
    addJobSpy = vi.spyOn(qm.queueManager, 'addJob').mockImplementation(async (type: any, data: any, opts: any) => {
      const id = `job_${crypto.randomUUID()}`;
      createdJobId = id;
      await db.insert(jobQueue).values({
        id,
        type: String(type),
        status: 'pending',
        workspaceId: String(opts?.workspaceId ?? ''),
        data: JSON.stringify(data ?? {}),
        createdAt: new Date(),
      });
      return id;
    });
  });

  afterEach(async () => {
    if (createdDocId) {
      await db.delete(contextDocuments).where(eq(contextDocuments.id, createdDocId));
    }
    if (createdJobId) {
      await db.delete(jobQueue).where(eq(jobQueue.id, createdJobId));
    }
    if (addJobSpy) addJobSpy.mockRestore();
    await cleanupAuthData(); // deletes users/sessions for both users
    await cleanupAuthData();
  });

  it('POST /documents uploads file, creates DB row, and enqueues document_summary job', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 1.pdf', { type: 'application/pdf' }));

    const res = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data.status).toBe('uploaded');
    expect(typeof data.job_id).toBe('string');

    createdDocId = data.id;

    // S3 put called
    expect(mockPutObject).toHaveBeenCalledTimes(1);

    // Job enqueued with workspaceId and documentId
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    const [jobType, jobData, jobOpts] = addJobSpy.mock.calls[0];
    expect(jobType).toBe('document_summary');
    expect(jobData.documentId).toBe(createdDocId);
    expect(jobOpts.workspaceId).toBeTruthy();
  });

  it('POST /documents accepts files larger than the previous 25 MB limit', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set(
      'file',
      new File([new Uint8Array(26 * 1024 * 1024)], 'Large doc.pdf', {
        type: 'application/pdf',
      }),
    );

    const res = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data.status).toBe('uploaded');

    createdDocId = data.id;

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledTimes(1);
  });

  it('POST /documents stores archive uploads as ready download-only docs without enqueueing summary jobs', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'bundle.tar.gz', {
        type: 'application/octet-stream',
      }),
    );

    const res = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data.status).toBe('ready');
    expect(data.indexing_skipped).toBe(true);
    expect(data.mime_type).toBe('application/gzip');
    expect(data.job_id).toBeUndefined();

    createdDocId = data.id;

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(mockPutObject.mock.calls[0]?.[0]?.contentType).toBe('application/gzip');
    expect(addJobSpy).not.toHaveBeenCalled();

    const meta = await app.request(`/api/v1/documents/${createdDocId}`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(meta.status).toBe(200);
    const doc = await meta.json();
    expect(doc.indexing_skipped).toBe(true);
    expect(doc.status).toBe('ready');

    mockGetObjectBodyStream.mockResolvedValueOnce(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([8, 8, 8]));
        controller.close();
      },
    }));

    const download = await app.request(`/api/v1/documents/${createdDocId}/content`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/gzip');
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('heals legacy download-only archive rows to ready when listed or fetched', async () => {
    const legacyDocId = crypto.randomUUID();
    createdDocId = legacyDocId;

    await db.insert(contextDocuments).values({
      id: legacyDocId,
      workspaceId: user.workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'test.tar.gz',
      mimeType: 'application/gzip',
      sizeBytes: 3 * 1024 * 1024,
      storageKey: `documents/${user.workspaceId}/folder/f_1/${legacyDocId}-test.tar.gz`,
      status: 'failed',
      data: {
        indexingSkipped: true,
        skipReason: 'archive_download_only',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const list = await app.request('/api/v1/documents?context_type=folder&context_id=f_1', {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.items.find((d: any) => d.id === legacyDocId)?.status).toBe('ready');

    const meta = await app.request(`/api/v1/documents/${legacyDocId}`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(meta.status).toBe(200);
    const doc = await meta.json();
    expect(doc.status).toBe('ready');
    expect(doc.indexing_skipped).toBe(true);
  });

  it('forbids viewers from uploading documents for non-chat contexts', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc viewer.pdf', { type: 'application/pdf' }));

    const res = await authenticatedMultipartRequest(app, '/api/v1/documents', viewer.sessionToken!, form);
    expect(res.status).toBe(403);
  });

  it('allows viewers to upload documents for chat_session', async () => {
    const chatRes = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', viewer.sessionToken!, {
      content: 'Viewer chat session doc upload',
    });
    expect(chatRes.status).toBe(200);
    const chatData = await chatRes.json();
    const sessionId = chatData.sessionId as string;

    const form = new FormData();
    form.set('context_type', 'chat_session');
    form.set('context_id', sessionId);
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc viewer chat.pdf', { type: 'application/pdf' }));

    const res = await authenticatedMultipartRequest(app, '/api/v1/documents', viewer.sessionToken!, form);
    expect(res.status).toBe(201);
    const created = await res.json();
    createdDocId = created.id;
    expect(created.context_type).toBe('chat_session');
  });

  it('GET /documents lists documents for a context', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 2.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    const list = await app.request('/api/v1/documents?context_type=folder&context_id=f_1', {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(list.status).toBe(200);
    const payload = await list.json();
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.some((d: any) => d.id === createdDocId)).toBe(true);
  });

  it('GET /documents/:id returns metadata', async () => {
    const form = new FormData();
    form.set('context_type', 'initiative');
    form.set('context_id', 'uc_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 3.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    const res = await app.request(`/api/v1/documents/${createdDocId}`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.id).toBe(createdDocId);
    expect(doc.context_type).toBe('initiative');
    expect(doc.context_id).toBe('uc_1');
  });

  it('GET /documents/:id/content streams download with headers', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 4.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    // A minimal stream body; Hono will forward it as Response body.
    mockGetObjectBodyStream.mockResolvedValueOnce(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9, 9]));
        controller.close();
      },
    }));

    const res = await app.request(`/api/v1/documents/${createdDocId}/content`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition') || '').toContain('attachment; filename=');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('DELETE /documents/:id deletes DB row (204) and best-effort deletes S3 object', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 5.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    const del = await app.request(`/api/v1/documents/${createdDocId}`, {
      method: 'DELETE',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(del.status).toBe(204);

    expect(mockDeleteObject).toHaveBeenCalledTimes(1);

    const getAfter = await app.request(`/api/v1/documents/${createdDocId}`, {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });
    expect(getAfter.status).toBe(404);

    // already deleted in DB; prevent afterEach from trying again
    createdDocId = null;
  });

  it('forbids viewers from deleting documents in a workspace where they are viewer', async () => {
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc viewer delete.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    const del = await app.request(
      `/api/v1/documents/${createdDocId}?workspace_id=${encodeURIComponent(user.workspaceId)}`,
      {
        method: 'DELETE',
        headers: { Cookie: `session=${viewer.sessionToken}` },
      }
    );
    expect(del.status).toBe(403);
  });

  it('allows viewers to delete documents in their chat_session', async () => {
    const chatRes = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', viewer.sessionToken!, {
      content: 'Viewer chat session delete',
    });
    expect(chatRes.status).toBe(200);
    const chatData = await chatRes.json();
    const sessionId = chatData.sessionId as string;

    const form = new FormData();
    form.set('context_type', 'chat_session');
    form.set('context_id', sessionId);
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc viewer delete chat.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', viewer.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    const del = await app.request(`/api/v1/documents/${createdDocId}`, {
      method: 'DELETE',
      headers: { Cookie: `session=${viewer.sessionToken}` },
    });
    expect(del.status).toBe(204);
    createdDocId = null;
  });

  it('admin_app can read documents from a workspace where they are a member (workspace_id query)', async () => {
    // Upload as editor in their own workspace
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 6.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    // Find editor workspace and grant admin_app membership
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .limit(1);
    expect(ws?.id).toBeTruthy();
    const editorWorkspaceId = ws!.id;
    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: editorWorkspaceId,
        userId: admin.id,
        role: 'viewer',
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    // Admin lists docs in that workspace
    const list = await app.request(`/api/v1/documents?context_type=folder&context_id=f_1&workspace_id=${encodeURIComponent(editorWorkspaceId)}`, {
      method: 'GET',
      headers: { Cookie: `session=${admin.sessionToken}` },
    });
    expect(list.status).toBe(200);
    const payload = await list.json();
    expect(payload.items.some((d: any) => d.id === createdDocId)).toBe(true);

    // Admin can GET metadata too
    const meta = await app.request(`/api/v1/documents/${createdDocId}?workspace_id=${encodeURIComponent(editorWorkspaceId)}`, {
      method: 'GET',
      headers: { Cookie: `session=${admin.sessionToken}` },
    });
    expect(meta.status).toBe(200);

    // Admin can download content with workspace_id
    mockGetObjectBodyStream.mockResolvedValueOnce(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([7, 7, 7]));
        controller.close();
      },
    }));
    const content = await app.request(
      `/api/v1/documents/${createdDocId}/content?workspace_id=${encodeURIComponent(editorWorkspaceId)}`,
      {
        method: 'GET',
        headers: { Cookie: `session=${admin.sessionToken}` },
      }
    );
    expect(content.status).toBe(200);
  });

  it('admin_app cannot read documents from a workspace where they are not a member (opaque 404)', async () => {
    // Upload as editor in their own workspace
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 7.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    // Find editor workspace (do not grant admin_app membership)
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .limit(1);
    expect(ws?.id).toBeTruthy();
    const editorWorkspaceId = ws!.id;

    const list = await app.request(
      `/api/v1/documents?context_type=folder&context_id=f_1&workspace_id=${encodeURIComponent(editorWorkspaceId)}`,
      {
        method: 'GET',
        headers: { Cookie: `session=${admin.sessionToken}` },
      }
    );
    expect(list.status).toBe(404);
  });
});
