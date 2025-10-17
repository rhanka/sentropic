import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestId, getTestModel } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';

describe('Use Case Generation - Sync (no waiting)', () => {
  let createdFolderId: string | null = null;
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    // Purge queue to avoid accumulation between tests
    try {
      await authenticatedRequest(
        app,
        'POST',
        '/queue/purge',
        user.sessionToken!,
        { status: 'force' }
      );
    } catch {}
    await cleanupAuthData();
  });

  it('should start generation and return job info immediately', async () => {
    const input = `Simple generation ${createTestId()}`;
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input,
        create_new_folder: true,
        model: getTestModel()
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('generating');
    expect(data.jobId).toBeDefined();
    expect(data.created_folder_id).toBeDefined();
    createdFolderId = data.created_folder_id;
  });
});


