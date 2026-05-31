import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('chat-server mounted api contract', () => {
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
});
