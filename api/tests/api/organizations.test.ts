import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { organizations } from '../../src/db/schema';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('Organization partial updates', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  it.each(['draft', 'enriching', 'completed'])('should preserve %s status when a field autosaves', async (status) => {
    const created = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Autosave ${createTestId()}`,
      status,
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const updated = await authenticatedRequest(app, 'PUT', `/api/v1/organizations/${id}`, user.sessionToken!, {
      industry: 'Technology',
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ status, industry: 'Technology' });
    const stored = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${id}`, user.sessionToken!);
    expect(await stored.json()).toMatchObject({ status, industry: 'Technology' });
  });

  it('should default new organizations to completed and accept explicit status updates', async () => {
    const created = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Default ${createTestId()}`,
    });
    expect(created.status).toBe(201);
    const org = await created.json();
    expect(org.status).toBe('completed');
    const updated = await authenticatedRequest(app, 'PUT', `/api/v1/organizations/${org.id}`, user.sessionToken!, {
      status: 'draft',
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ status: 'draft' });
  });
});
