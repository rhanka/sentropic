import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { jobQueue } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('Chat history_analyze endpoint wiring', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('enqueues history_analyze as requested chat tool', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Analyse l historique de cette conversation',
        tools: ['history_analyze'],
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, body.jobId));

    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('chat_message');

    const payloadRaw = jobs[0].data as unknown;
    const payload =
      typeof payloadRaw === 'string'
        ? JSON.parse(payloadRaw)
        : (payloadRaw as Record<string, unknown>);

    expect(Array.isArray(payload.tools)).toBe(true);
    expect((payload.tools as unknown[]).map(String)).toContain('history_analyze');
  });
});
