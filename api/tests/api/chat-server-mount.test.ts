import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { jobQueue } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { inArray } from 'drizzle-orm';

describe('chat-server mounted api contract', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;
  let createdJobIds: string[];

  beforeEach(async () => {
    createdJobIds = [];
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await db.delete(jobQueue).where(inArray(jobQueue.id, createdJobIds));
    }
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  it('rejects unsupported future wire-version negotiation on mounted chat routes', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Versioned future header should be rejected' },
      { 'Sec-Sentropic-Wire-Version': '2026-01-draft' },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Sec-Sentropic-Wire-Version is not supported',
    });
  });

  it('routes turn-control endpoints through the mounted chat-server middleware', async () => {
    const createdResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Control route mount check' },
    );
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    createdJobIds.push(String(created.jobId));

    const response = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/stop`,
      user.sessionToken!,
      {},
      { 'Sec-Sentropic-Wire-Version': '2026-01-draft' },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Sec-Sentropic-Wire-Version is not supported',
    });
  });
});
