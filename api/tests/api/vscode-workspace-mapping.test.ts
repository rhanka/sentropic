import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { workspaceMemberships, workspaces } from '../../src/db/schema';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('VSCode project/workspace mapping API', () => {
  let editor: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    editor = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await db.run(
      sql`DELETE FROM settings WHERE key = 'vscode_project_workspace_state_v1'`,
    );
    await cleanupAuthData();
  });

  it('returns a sanitized mapping snapshot for the current project fingerprint', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/vscode-extension/workspace-mapping?project_fingerprint=repo.main.001',
      editor.sessionToken!,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      projectFingerprint: string;
      mappedWorkspaceId: string | null;
      mappedWorkspaceName: string | null;
      lastWorkspaceId: string | null;
      codeWorkspaces: Array<{ id: string; name: string; role: string }>;
    };

    expect(payload.projectFingerprint).toBe('repo.main.001');
    expect(payload.mappedWorkspaceId).toBeNull();
    expect(payload.mappedWorkspaceName).toBeNull();
    expect(payload.codeWorkspaces.length).toBeGreaterThanOrEqual(1);
    expect(payload.codeWorkspaces.some((workspace) => workspace.id === editor.workspaceId)).toBe(true);
  });

  it('persists project mapping updates for accessible workspaces only', async () => {
    const workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: editor.id,
      name: 'Code Workspace B',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(workspaceMemberships).values({
      workspaceId,
      userId: editor.id,
      role: 'editor',
      createdAt: new Date(),
    });

    const putResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/vscode-extension/workspace-mapping',
      editor.sessionToken!,
      {
        projectFingerprint: 'repo.main.002',
        workspaceId,
      },
    );
    expect(putResponse.status).toBe(200);

    const putPayload = (await putResponse.json()) as {
      mappedWorkspaceId: string | null;
      mappedWorkspaceName: string | null;
    };
    expect(putPayload.mappedWorkspaceId).toBe(workspaceId);
    expect(putPayload.mappedWorkspaceName).toBe('Code Workspace B');

    const getResponse = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/vscode-extension/workspace-mapping?project_fingerprint=repo.main.002',
      editor.sessionToken!,
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      projectFingerprint: 'repo.main.002',
      mappedWorkspaceId: workspaceId,
      mappedWorkspaceName: 'Code Workspace B',
    });

    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('rejects mapping updates for workspaces outside the current user scope', async () => {
    const outsiderWorkspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: outsiderWorkspaceId,
      ownerUserId: null,
      name: 'Outsider Workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/vscode-extension/workspace-mapping',
      editor.sessionToken!,
      {
        projectFingerprint: 'repo.main.003',
        workspaceId: outsiderWorkspaceId,
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Workspace not found in user scope.',
    });

    await db.delete(workspaces).where(eq(workspaces.id, outsiderWorkspaceId));
  });
});
