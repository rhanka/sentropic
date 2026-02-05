import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { workspaces, workspaceMemberships } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildImportZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  const workspaceId = `ws_${createTestId()}`;
  const workspacesPayload = [{ id: workspaceId, name: 'Imported workspace' }];
  const files: Array<{ path: string; bytes: Uint8Array }> = [
    { path: 'workspaces.json', bytes: new TextEncoder().encode(stableStringify(workspacesPayload)) },
  ];
  const manifestFiles = files.map((f) => ({
    path: f.path,
    bytes: f.bytes.byteLength,
    sha256: sha256Bytes(f.bytes),
  }));
  for (const f of files) {
    zip.file(f.path, f.bytes);
  }
  const manifestCore = {
    export_version: '1.0',
    schema_version: 'test',
    created_at: new Date().toISOString(),
    scope: 'workspace',
    scope_id: null,
    include_comments: false,
    include_documents: false,
    files: manifestFiles,
  };
  const manifestHash = sha256Bytes(new TextEncoder().encode(stableStringify(manifestCore)));
  zip.file('manifest.json', new TextEncoder().encode(stableStringify({ ...manifestCore, manifest_hash: manifestHash })));
  zip.file(
    'meta.json',
    new TextEncoder().encode(stableStringify({ title: 'Exported workspace data', notes: 'Test', source: 'top-ai-ideas' }))
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Workspaces API', () => {
  let app: any;
  let editor: any;
  let viewer: any;
  const createdWorkspaceIds: string[] = [];

  async function createWorkspace(name = `WS ${Date.now()}`) {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, { name });
    expect(res.status).toBe(201);
    const json = await res.json();
    const id = String(json?.id ?? '');
    expect(id).toBeTruthy();
    createdWorkspaceIds.push(id);
    return id;
  }

  beforeEach(async () => {
    app = await importApp();
    editor = await createAuthenticatedUser('editor', `editor-${Date.now()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-${Date.now()}@example.com`);
    if (editor.workspaceId) createdWorkspaceIds.push(editor.workspaceId);
    if (viewer.workspaceId) createdWorkspaceIds.push(viewer.workspaceId);
  });

  afterEach(async () => {
    for (const id of createdWorkspaceIds) {
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    createdWorkspaceIds.length = 0;
    await cleanupAuthData();
  });

  it('ignore workspace_id on bootstrap routes (/workspaces, /me)', async () => {
    const resWorkspaces = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/workspaces?workspace_id=invalid',
      editor.sessionToken
    );
    expect(resWorkspaces.status).toBe(200);

    const resMe = await authenticatedRequest(app, 'GET', '/api/v1/me?workspace_id=invalid', editor.sessionToken);
    expect(resMe.status).toBe(200);
  });

  it('returns 404 when scoping to a workspace the user is not member of', async () => {
    const otherWorkspaceId = viewer.workspaceId!;
    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/folders?workspace_id=${otherWorkspaceId}`,
      editor.sessionToken
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when accessing a hidden workspace on non-settings routes', async () => {
    const wsId = await createWorkspace();
    const hide = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/hide`,
      editor.sessionToken,
      {}
    );
    expect(hide.status).toBe(200);

    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/folders?workspace_id=${wsId}`,
      editor.sessionToken
    );
    expect(res.status).toBe(409);
  });

  it('enforces admin role for workspace lifecycle actions', async () => {
    const wsId = await createWorkspace();
    await db.insert(workspaceMemberships).values({
      workspaceId: wsId,
      userId: viewer.id,
      role: 'viewer',
      createdAt: new Date(),
    });

    const hideAsViewer = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/hide`,
      viewer.sessionToken,
      {}
    );
    expect(hideAsViewer.status).toBe(403);

    const hideAsAdmin = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/hide`,
      editor.sessionToken,
      {}
    );
    expect(hideAsAdmin.status).toBe(200);

    const unhide = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/unhide`,
      editor.sessionToken,
      {}
    );
    expect(unhide.status).toBe(200);

    const hideAgain = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/hide`,
      editor.sessionToken,
      {}
    );
    expect(hideAgain.status).toBe(200);

    const del = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/workspaces/${wsId}`,
      editor.sessionToken
    );
    expect(del.status).toBe(204);
  });

  it('allows admins to manage members, rejects non-admins', async () => {
    const wsId = await createWorkspace();

    const addAsViewer = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/members`,
      viewer.sessionToken,
      { email: editor.email, role: 'viewer' }
    );
    expect(addAsViewer.status).toBe(403);

    const add = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${wsId}/members`,
      editor.sessionToken,
      { email: viewer.email, role: 'viewer' }
    );
    expect(add.status).toBe(200);

    const update = await authenticatedRequest(
      app,
      'PATCH',
      `/api/v1/workspaces/${wsId}/members/${viewer.id}`,
      editor.sessionToken,
      { role: 'editor' }
    );
    expect(update.status).toBe(200);

    const remove = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/workspaces/${wsId}/members/${viewer.id}`,
      editor.sessionToken
    );
    expect(remove.status).toBe(204);
  });

  it('requires admin to export workspace', async () => {
    await db.insert(workspaceMemberships).values({
      workspaceId: editor.workspaceId!,
      userId: viewer.id,
      role: 'viewer',
      createdAt: new Date(),
    });

    const resEditor = await authenticatedRequest(app, 'POST', '/api/v1/exports', editor.sessionToken, {
      scope: 'workspace',
      include_comments: false,
      include_documents: false,
    });
    expect(resEditor.status).toBe(403);

    const resViewer = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/exports?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
      scope: 'workspace',
      include_comments: false,
      include_documents: false,
      }
    );
    expect(resViewer.status).toBe(403);
  });

  it('requires admin to import into existing workspace', async () => {
    await db.insert(workspaceMemberships).values({
      workspaceId: editor.workspaceId!,
      userId: viewer.id,
      role: 'viewer',
      createdAt: new Date(),
    });

    const zipBytes = await buildImportZip();
    const form = new FormData();
    form.set('file', new File([zipBytes], 'import.zip', { type: 'application/zip' }));
    form.set('target_workspace_id', editor.workspaceId!);

    const resEditor = await app.request('/api/v1/imports', {
      method: 'POST',
      headers: { Cookie: `session=${editor.sessionToken}` },
      body: form as any,
    });
    expect(resEditor.status).toBe(403);

    const resViewer = await app.request('/api/v1/imports', {
      method: 'POST',
      headers: { Cookie: `session=${viewer.sessionToken}` },
      body: form as any,
    });
    expect(resViewer.status).toBe(403);
  });
});
