import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { extensionToolPermissions } from '../../src/db/schema';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('Chat tool permissions API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('upserts and lists extension tool permissions per user/workspace', async () => {
    const put1 = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
      {
        toolName: 'tab_read:dom',
        origin: 'https://github.com/rhanka/top-ai-ideas-fullstack',
        policy: 'allow',
      },
    );
    expect(put1.status).toBe(200);
    const put1Body = await put1.json();
    expect(put1Body.ok).toBe(true);
    expect(put1Body.item.origin).toBe('https://github.com');
    expect(put1Body.item.policy).toBe('allow');

    const put2 = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
      {
        toolName: 'tab_read:dom',
        origin: 'https://github.com',
        policy: 'deny',
      },
    );
    expect(put2.status).toBe(200);
    const put2Body = await put2.json();
    expect(put2Body.ok).toBe(true);
    expect(put2Body.item.policy).toBe('deny');

    const list = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(Array.isArray(listBody.items)).toBe(true);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      toolName: 'tab_read:dom',
      origin: 'https://github.com',
      policy: 'deny',
    });

    const rows = await db
      .select()
      .from(extensionToolPermissions)
      .where(
        and(
          eq(extensionToolPermissions.userId, user.id),
          eq(extensionToolPermissions.workspaceId, user.workspaceId!),
          eq(extensionToolPermissions.toolName, 'tab_read:dom'),
          eq(extensionToolPermissions.origin, 'https://github.com'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].policy).toBe('deny');
  });

  it('deletes an existing permission policy', async () => {
    const put = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
      {
        toolName: 'tab_action',
        origin: 'https://example.com',
        policy: 'allow',
      },
    );
    expect(put.status).toBe(200);

    const del = await authenticatedRequest(
      app,
      'DELETE',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
      {
        toolName: 'tab_action',
        origin: 'https://example.com/path',
      },
    );
    expect(del.status).toBe(200);
    const delBody = await del.json();
    expect(delBody.ok).toBe(true);

    const list = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
    );
    const listBody = await list.json();
    expect(listBody.items).toEqual([]);
  });

  it('rejects invalid origins', async () => {
    const response = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/chat/tool-permissions',
      user.sessionToken!,
      {
        toolName: 'tab_read:dom',
        origin: 'chrome://extensions',
        policy: 'allow',
      },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(String(body.error || '')).toContain('Invalid origin');
  });

  it('requires authentication', async () => {
    const response = await app.request('/api/v1/chat/tool-permissions', {
      method: 'GET',
    });
    expect(response.status).toBe(401);
  });
});
