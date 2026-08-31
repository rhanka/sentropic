import { createCommentsRouter } from '@sentropic/comments/hono';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { comments, organizations } from '../../src/db/schema';
import { commentsRouter as legacyCommentsRouter } from '../../src/routes/api/comments';
import { createProductCommentsRouterOptions } from '../../src/routes/namespaces/comments-ports';
import { commentStore } from '../../src/services/comments/instance';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('cluster mesh comments cutover shadow', () => {
  let user: TestUser;
  let organizationId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor', `comments-cutover-${createTestId()}@example.com`);
    const response = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/organizations',
      user.sessionToken!,
      { name: `Comments cutover ${createTestId()}`, industry: 'Technology' },
    );
    expect(response.status).toBe(201);
    organizationId = (await response.json() as { id: string }).id;
  });

  afterEach(async () => {
    if (user.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, user.workspaceId));
      await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
  });

  const candidateApp = () => {
    const options = createProductCommentsRouterOptions();
    return new Hono().route('/api/v1', createCommentsRouter({
      ...options,
      authz: {
        ...options.authz,
        resolvePrincipal: async () => ({
          userId: user.id,
          workspaceId: user.workspaceId!,
        }),
      },
    }));
  };

  it('matches the legacy safe read byte-for-byte', async () => {
    const path = `/api/v1/comments?context_type=organization&context_id=${organizationId}`;
    const legacy = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    const candidate = await candidateApp().request(path);

    expect(candidate.status).toBe(legacy.status);
    expect(await candidate.text()).toBe(await legacy.text());
    expect(legacyCommentsRouter.routes.length).toBeGreaterThan(0);
  });

  it('matches legacy validation without authoring a mutation', async () => {
    const add = vi.spyOn(commentStore, 'add');
    const body = {
      context_type: 'organization',
      context_id: organizationId,
      content: '',
    };
    const legacy = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/comments',
      user.sessionToken!,
      body,
    );
    const candidate = await candidateApp().request('/api/v1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(candidate.status).toBe(legacy.status);
    expect(await candidate.text()).toBe(await legacy.text());
    expect(add).not.toHaveBeenCalled();
  });
});
