import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { contextDocuments, jobQueue, workspaces } from '../../src/db/schema';
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
  let app: any;
  let createdDocId: string | null = null;
  let createdJobId: string | null = null;
  let addJobSpy: any;

  beforeEach(async () => {
    app = await importApp();
    user = await createAuthenticatedUser('editor');
    admin = await createAuthenticatedUser('admin_app');
    mockPutObject.mockReset();
    mockDeleteObject.mockReset();
    mockGetObjectBodyStream.mockReset();
    createdJobId = null;
    createdDocId = null;

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
    form.set('context_type', 'usecase');
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
    expect(doc.context_type).toBe('usecase');
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

  it('admin_app can read documents from a shared workspace via workspace_id query param', async () => {
    // Upload as editor in their own workspace
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 6.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    // Find editor workspace and mark it shareWithAdmin=true
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .limit(1);
    expect(ws?.id).toBeTruthy();
    const editorWorkspaceId = ws!.id;
    await db
      .update(workspaces)
      .set({ shareWithAdmin: true })
      .where(eq(workspaces.id, editorWorkspaceId));

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
  });

  it('admin_app cannot read documents from a non-shared workspace via workspace_id (opaque 404)', async () => {
    // Upload as editor in their own workspace
    const form = new FormData();
    form.set('context_type', 'folder');
    form.set('context_id', 'f_1');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Doc 7.pdf', { type: 'application/pdf' }));
    const up = await authenticatedMultipartRequest(app, '/api/v1/documents', user.sessionToken!, form);
    expect(up.status).toBe(201);
    const created = await up.json();
    createdDocId = created.id;

    // Find editor workspace and ensure shareWithAdmin=false
    const [ws] = await db
      .select({ id: workspaces.id, shareWithAdmin: workspaces.shareWithAdmin })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .limit(1);
    expect(ws?.id).toBeTruthy();
    const editorWorkspaceId = ws!.id;
    await db.update(workspaces).set({ shareWithAdmin: false }).where(eq(workspaces.id, editorWorkspaceId));

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


