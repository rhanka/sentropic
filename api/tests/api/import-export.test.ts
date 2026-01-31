import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import { app } from '../../src/app';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { folders, organizations, useCases, workspaceMemberships, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';

type TestUser = Awaited<ReturnType<typeof createAuthenticatedUser>>;

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

async function buildImportZip(opts: {
  scope: 'workspace';
  includeComments: boolean;
  includeDocuments: boolean;
  workspaceId: string;
  orgId: string;
  folderId: string;
  useCaseId: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();

  const workspaces = [{ id: opts.workspaceId, name: 'Imported workspace' }];
  const organizations = [{ id: opts.orgId, workspace_id: opts.workspaceId, name: 'Org', status: 'completed', data: {} }];
  const folders = [
    {
      id: opts.folderId,
      workspace_id: opts.workspaceId,
      name: 'Folder',
      description: null,
      organization_id: opts.orgId,
      matrix_config: null,
      executive_summary: null,
      status: 'completed',
      created_at: new Date().toISOString(),
    },
  ];
  const useCases = [
    {
      id: opts.useCaseId,
      workspace_id: opts.workspaceId,
      folder_id: opts.folderId,
      organization_id: opts.orgId,
      status: 'completed',
      model: null,
      data: {},
      created_at: new Date().toISOString(),
    },
  ];

  const files: Array<{ path: string; bytes: Uint8Array }> = [
    { path: 'workspaces.json', bytes: new TextEncoder().encode(stableStringify(workspaces)) },
    { path: 'organizations.json', bytes: new TextEncoder().encode(stableStringify(organizations)) },
    { path: 'folders.json', bytes: new TextEncoder().encode(stableStringify(folders)) },
    { path: 'use_cases.json', bytes: new TextEncoder().encode(stableStringify(useCases)) },
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
    scope: opts.scope,
    scope_id: null,
    include_comments: opts.includeComments,
    include_documents: opts.includeDocuments,
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

describe('Import/Export API', () => {
  let admin: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  const createdWorkspaceIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdFolderIds: string[] = [];
  const createdUseCaseIds: string[] = [];

  beforeEach(async () => {
    admin = await createAuthenticatedUser('admin', `admin-${createTestId()}@example.com`);
    editor = await createAuthenticatedUser('editor', `editor-${createTestId()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-${createTestId()}@example.com`);

    if (admin.workspaceId) createdWorkspaceIds.push(admin.workspaceId);
    if (editor.workspaceId) createdWorkspaceIds.push(editor.workspaceId);
    if (viewer.workspaceId) createdWorkspaceIds.push(viewer.workspaceId);

    await db.insert(workspaceMemberships).values([
      { workspaceId: admin.workspaceId!, userId: editor.id, role: 'editor', createdAt: new Date() },
      { workspaceId: admin.workspaceId!, userId: viewer.id, role: 'viewer', createdAt: new Date() },
    ]);

    const orgId = `org_${createTestId()}`;
    const folderId = `folder_${createTestId()}`;
    const useCaseId = `uc_${createTestId()}`;
    createdOrgIds.push(orgId);
    createdFolderIds.push(folderId);
    createdUseCaseIds.push(useCaseId);

    await db.insert(organizations).values({
      id: orgId,
      workspaceId: admin.workspaceId!,
      name: 'Org',
      status: 'completed',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(folders).values({
      id: folderId,
      workspaceId: admin.workspaceId!,
      name: 'Folder',
      description: null,
      organizationId: orgId,
      matrixConfig: null,
      executiveSummary: null,
      status: 'completed',
      createdAt: new Date(),
    });
    await db.insert(useCases).values({
      id: useCaseId,
      workspaceId: admin.workspaceId!,
      folderId,
      organizationId: orgId,
      status: 'completed',
      model: null,
      data: {},
      createdAt: new Date(),
    });
  });

  afterEach(async () => {
    if (createdUseCaseIds.length > 0) {
      await db.delete(useCases).where(eq(useCases.id, createdUseCaseIds.pop()!));
    }
    if (createdFolderIds.length > 0) {
      await db.delete(folders).where(eq(folders.id, createdFolderIds.pop()!));
    }
    if (createdOrgIds.length > 0) {
      await db.delete(organizations).where(eq(organizations.id, createdOrgIds.pop()!));
    }
    for (const wsId of createdWorkspaceIds) {
      await db.delete(useCases).where(eq(useCases.workspaceId, wsId));
      await db.delete(folders).where(eq(folders.workspaceId, wsId));
      await db.delete(organizations).where(eq(organizations.workspaceId, wsId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    createdWorkspaceIds.length = 0;
    await cleanupAuthData();
  });

  it('allows admin to export workspace and returns a zip manifest', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/exports', admin.sessionToken!, {
      scope: 'workspace',
      include_comments: false,
      include_documents: false,
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const manifest = zip.file('manifest.json');
    expect(manifest).toBeTruthy();
    const manifestText = await manifest!.async('string');
    const parsed = JSON.parse(manifestText) as { scope?: string };
    expect(parsed.scope).toBe('workspace');
    expect(zip.file('workspaces.json')).toBeTruthy();
  });

  it('rejects workspace export for viewer', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/exports', viewer.sessionToken!, {
      scope: 'workspace',
      include_comments: false,
      include_documents: false,
    });
    expect(res.status).toBe(403);
  });

  it('allows editor to export folder scope', async () => {
    const folderId = createdFolderIds[0];
    const res = await authenticatedRequest(app, 'POST', '/api/v1/exports', editor.sessionToken!, {
      scope: 'folder',
      scope_id: folderId,
      include_comments: false,
      include_documents: false,
    });
    expect(res.status).toBe(200);
  });

  it('rejects import into existing workspace for viewer', async () => {
    const zipBytes = await buildImportZip({
      scope: 'workspace',
      includeComments: false,
      includeDocuments: false,
      workspaceId: `ws_${createTestId()}`,
      orgId: `org_${createTestId()}`,
      folderId: `folder_${createTestId()}`,
      useCaseId: `uc_${createTestId()}`,
    });
    const form = new FormData();
    form.set('file', new File([zipBytes], 'import.zip', { type: 'application/zip' }));
    form.set('target_workspace_id', admin.workspaceId!);

    const res = await app.request('/api/v1/imports', {
      method: 'POST',
      headers: { Cookie: `session=${viewer.sessionToken}` },
      body: form as any,
    });
    expect(res.status).toBe(403);
  });

  it('allows import to new workspace for viewer', async () => {
    const zipBytes = await buildImportZip({
      scope: 'workspace',
      includeComments: false,
      includeDocuments: false,
      workspaceId: `ws_${createTestId()}`,
      orgId: `org_${createTestId()}`,
      folderId: `folder_${createTestId()}`,
      useCaseId: `uc_${createTestId()}`,
    });
    const form = new FormData();
    form.set('file', new File([zipBytes], 'import.zip', { type: 'application/zip' }));

    const res = await app.request('/api/v1/imports', {
      method: 'POST',
      headers: { Cookie: `session=${viewer.sessionToken}` },
      body: form as any,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const workspaceId = String(body?.workspace_id ?? '');
    expect(workspaceId.length).toBeGreaterThan(0);
    createdWorkspaceIds.push(workspaceId);
  });
});
