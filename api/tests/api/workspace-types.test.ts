import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { workspaces, workspaceMemberships } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { ensureNeutralWorkspace } from '../../src/services/workspace-service';

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

describe('Workspace type system', () => {
  let app: any;
  let editor: any;
  let viewer: any;
  const createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    app = await importApp();
    editor = await createAuthenticatedUser('editor', `editor-wt-${Date.now()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-wt-${Date.now()}@example.com`);
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

  // --- Task 1: workspace creation with type ---

  it('creates a workspace with explicit type', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Opportunity WS',
      type: 'opportunity',
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    createdWorkspaceIds.push(json.id);

    // Verify the type in DB
    const [ws] = await db.select({ type: workspaces.type }).from(workspaces).where(eq(workspaces.id, json.id)).limit(1);
    expect(ws.type).toBe('opportunity');
  });

  it('defaults type to ai-ideas when not specified', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Default Type WS',
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    createdWorkspaceIds.push(json.id);

    const [ws] = await db.select({ type: workspaces.type }).from(workspaces).where(eq(workspaces.id, json.id)).limit(1);
    expect(ws.type).toBe('ai-ideas');
  });

  it('rejects neutral type on manual creation', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Neutral WS',
      type: 'neutral',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Neutral');
  });

  it('rejects invalid type values', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Bad Type WS',
      type: 'invalid-type',
    });
    expect(res.status).toBe(400);
  });

  it('returns type in workspace list', async () => {
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Code WS',
      type: 'code',
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();
    createdWorkspaceIds.push(id);

    const listRes = await authenticatedRequest(app, 'GET', '/api/v1/workspaces', editor.sessionToken);
    expect(listRes.status).toBe(200);
    const { items } = await listRes.json();
    const codeWs = items.find((w: any) => w.id === id);
    expect(codeWs).toBeDefined();
    expect(codeWs.type).toBe('code');
  });

  // --- Task 2: neutral auto-creation ---

  it('auto-creates a neutral workspace via ensureNeutralWorkspace', async () => {
    const neutralId = await ensureNeutralWorkspace(editor.id);
    createdWorkspaceIds.push(neutralId);

    const [ws] = await db
      .select({ type: workspaces.type, ownerUserId: workspaces.ownerUserId })
      .from(workspaces)
      .where(eq(workspaces.id, neutralId))
      .limit(1);
    expect(ws.type).toBe('neutral');
    expect(ws.ownerUserId).toBe(editor.id);

    // Verify membership exists
    const [membership] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, neutralId), eq(workspaceMemberships.userId, editor.id)))
      .limit(1);
    expect(membership.role).toBe('admin');
  });

  it('ensureNeutralWorkspace is idempotent', async () => {
    const id1 = await ensureNeutralWorkspace(editor.id);
    createdWorkspaceIds.push(id1);
    const id2 = await ensureNeutralWorkspace(editor.id);
    expect(id1).toBe(id2);
  });

  // --- Task 3: neutral constraints ---

  it('blocks adding members to neutral workspaces', async () => {
    const neutralId = await ensureNeutralWorkspace(editor.id);
    createdWorkspaceIds.push(neutralId);

    const res = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/workspaces/${neutralId}/members`,
      editor.sessionToken,
      { email: viewer.email, role: 'viewer' }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Neutral');
  });

  // --- Task 4: type immutability ---

  it('rejects type change on workspace update', async () => {
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Immutable Type WS',
      type: 'ai-ideas',
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();
    createdWorkspaceIds.push(id);

    const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/workspaces/${id}`, editor.sessionToken, {
      name: 'Renamed WS',
      type: 'code',
    });
    expect(updateRes.status).toBe(400);
    const json = await updateRes.json();
    expect(json.error).toContain('type');
  });

  it('allows renaming without type field', async () => {
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: 'Rename OK WS',
      type: 'ai-ideas',
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();
    createdWorkspaceIds.push(id);

    const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/workspaces/${id}`, editor.sessionToken, {
      name: 'Renamed OK WS',
    });
    expect(updateRes.status).toBe(200);
  });
});
