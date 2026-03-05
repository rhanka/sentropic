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
    expect(payload.codeWorkspaces).toEqual([]);
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
    await db.run(sql`
      INSERT INTO settings (key, user_id, value, description, updated_at)
      VALUES (
        'vscode_project_workspace_state_v1',
        ${editor.id},
        ${JSON.stringify({
          version: 1,
          mappings: {},
          codeWorkspaceIds: [workspaceId],
          lastWorkspaceId: workspaceId,
          updatedAt: new Date().toISOString(),
        })},
        'test mapping state',
        ${new Date().toISOString()}
      )
      ON CONFLICT (user_id, key) WHERE user_id IS NOT NULL
      DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at
    `);

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

  it('creates a code workspace and maps current project in one call', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/vscode-extension/workspace-mapping/code-workspace',
      editor.sessionToken!,
      {
        projectFingerprint: 'repo.main.004',
        name: 'My Code Base',
      },
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      mappedWorkspaceId: string | null;
      mappedWorkspaceName: string | null;
      codeWorkspaces: Array<{ id: string; name: string; role: string }>;
    };
    expect(payload.mappedWorkspaceId).toBeTruthy();
    expect(payload.mappedWorkspaceName).toBe('My Code Base');
    expect(payload.codeWorkspaces.some((workspace) => workspace.id === payload.mappedWorkspaceId)).toBe(true);
  });

  it('uses repository name as default workspace name when explicit name is omitted', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/vscode-extension/workspace-mapping/code-workspace',
      editor.sessionToken!,
      {
        projectFingerprint: 'repo.main.004b',
        repositoryName: 'top-ai-ideas-fullstack',
      },
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      mappedWorkspaceName: string | null;
    };
    expect(payload.mappedWorkspaceName).toBe('top-ai-ideas-fullstack');
  });

  it('supports not-now fallback to last registered code workspace', async () => {
    const codeWorkspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: codeWorkspaceId,
      ownerUserId: editor.id,
      name: 'Code Workspace C',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: codeWorkspaceId,
      userId: editor.id,
      role: 'editor',
      createdAt: new Date(),
    });
    await db.run(sql`
      INSERT INTO settings (key, user_id, value, description, updated_at)
      VALUES (
        'vscode_project_workspace_state_v1',
        ${editor.id},
        ${JSON.stringify({
          version: 1,
          mappings: {},
          codeWorkspaceIds: [codeWorkspaceId],
          lastWorkspaceId: codeWorkspaceId,
          updatedAt: new Date().toISOString(),
        })},
        'test mapping state',
        ${new Date().toISOString()}
      )
      ON CONFLICT (user_id, key) WHERE user_id IS NOT NULL
      DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at
    `);

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/vscode-extension/workspace-mapping/not-now',
      editor.sessionToken!,
      {
        projectFingerprint: 'repo.main.005',
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projectFingerprint: 'repo.main.005',
      mappedWorkspaceId: codeWorkspaceId,
      mappedWorkspaceName: 'Code Workspace C',
    });

    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, codeWorkspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, codeWorkspaceId));
  });
});
