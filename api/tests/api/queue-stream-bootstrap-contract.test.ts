import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { chatStreamEvents, jobQueue } from '../../src/db/schema';
import { writeStreamEvent } from '../../src/services/stream-service';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('Queue stream bootstrap contract', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let jobId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    jobId = createTestId();

    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'processing',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        templateId: 'usecase-onepage',
        entityType: 'usecase',
        entityId: createTestId(),
        locale: 'fr',
      }),
      createdAt: new Date(),
    });

    await writeStreamEvent(`job_${jobId}`, 'status', { state: 'queued', progress: 0 }, 1);
    await writeStreamEvent(`job_${jobId}`, 'status', { state: 'rendering', progress: 50 }, 2);
    await writeStreamEvent(`job_${jobId}`, 'done', { state: 'done', progress: 100 }, 3);
  });

  afterEach(async () => {
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, `job_${jobId}`));
    await db.delete(jobQueue).where(eq(jobQueue.id, jobId));
    await cleanupAuthData();
  });

  it('returns stream snapshot for a workspace-visible job', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/queue/jobs/${jobId}/stream-bootstrap`,
      user.sessionToken!,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobId).toBe(jobId);
    expect(body.streamId).toBe(`job_${jobId}`);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(3);
    expect(body.events[0].eventType).toBe('status');
    expect(body.events[2].eventType).toBe('done');
  });

  it('respects limit parameter', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/queue/jobs/${jobId}/stream-bootstrap?limit=2`,
      user.sessionToken!,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].sequence).toBe(1);
    expect(body.events[1].sequence).toBe(2);
  });
});
