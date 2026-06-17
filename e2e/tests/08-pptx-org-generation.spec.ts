import { test, expect, request } from '@playwright/test';

/**
 * PPTX generation is deterministic here: POST /pptx/generate creates a completed
 * `pptx_generate` job, then the download route proves the binary contract.
 */
test.describe('PPTX generation (organization context)', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  test('generates a PPTX and serves it on the download route', async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    try {
      const workspaceName = `PPTX Org Gen ${Date.now()}`;
      const workspaceRes = await userAApi.post('/api/v1/workspaces', {
        data: { name: workspaceName },
      });
      expect(workspaceRes.ok()).toBeTruthy();
      const workspace = await workspaceRes.json().catch(() => null);
      const workspaceId = String(workspace?.id ?? '');
      expect(workspaceId).toBeTruthy();

      const orgName = `PPTX Source Org ${Date.now()}`;
      const orgRes = await userAApi.post(
        `/api/v1/organizations?workspace_id=${workspaceId}`,
        {
          data: {
            name: orgName,
            data: { industry: 'Manufacturing', technologies: 'Robotics, IoT' },
          },
        },
      );
      expect(orgRes.ok()).toBeTruthy();
      const org = await orgRes.json().catch(() => null);
      const orgId = String(org?.id ?? '');
      expect(orgId).toBeTruthy();

      const generateRes = await userAApi.post('/api/v1/pptx/generate', {
        data: {
          entityType: 'organization',
          entityId: orgId,
          title: orgName,
        },
      });
      expect(generateRes.status()).toBe(200);
      const generateBody = await generateRes.json().catch(() => null);
      const jobId = String(generateBody?.jobId ?? '');
      expect(jobId).toBeTruthy();

      const downloadRes = await userAApi.get(
        `/api/v1/pptx/jobs/${encodeURIComponent(jobId)}/download?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect(downloadRes.status()).toBe(200);
      const contentType = downloadRes.headers()['content-type'] ?? '';
      expect(contentType).toContain(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      const body = await downloadRes.body();
      expect(body.length).toBeGreaterThan(0);
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    } finally {
      await userAApi.dispose();
    }
  });
});
