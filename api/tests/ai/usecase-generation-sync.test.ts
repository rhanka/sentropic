import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId, getTestModel } from '../utils/test-helpers';

describe('Use Case Generation - Sync (no waiting)', () => {
  let createdFolderId: string | null = null;

  afterEach(async () => {
    // Purge queue to avoid accumulation between tests
    try {
      await apiRequest('/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  it('should start generation and return job info immediately', async () => {
    const input = `Simple generation ${createTestId()}`;
    const response = await apiRequest('/api/v1/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify({
        input,
        create_new_folder: true,
        model: getTestModel()
      })
    });

    expect(response.ok).toBe(true);
    expect(response.data.success).toBe(true);
    expect(response.data.status).toBe('generating');
    expect(response.data.jobId).toBeDefined();
    expect(response.data.created_folder_id).toBeDefined();
    createdFolderId = response.data.created_folder_id;
  });
});


