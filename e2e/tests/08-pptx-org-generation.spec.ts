import { test, expect, request } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

/**
 * PPTX generation is AI-gated: it is produced by the chat tool `document_generate`
 * (format: "pptx", freeform PptGenJS sandbox). There is no non-AI UI button and no
 * direct API endpoint to create a `pptx_generate` job. This spec therefore drives
 * the chat with the default e2e model to trigger the tool, then asserts the
 * download-route request+response CONTRACT only (HTTP 200 + PPTX content-type) —
 * it never asserts AI-generated slide content.
 *
 * AI flaky: nondeterministic provider/tool-call behavior is acceptable per the
 * AI allowlist; failure signature must indicate model nondeterminism.
 */
test.setTimeout(8 * 60_000);

test.describe('Chat PPTX generation (organization context)', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  const pollForCompletedPptxJob = async (
    page: import('@playwright/test').Page,
    workspaceId: string,
    timeoutMs = 5 * 60_000,
  ): Promise<string> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const res = await page.request.get(
        `${API_BASE_URL}/api/v1/queue/jobs?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      if (res.ok()) {
        const body = await res.json().catch(() => null);
        const jobs: any[] = Array.isArray(body) ? body : (body?.items ?? []);
        const pptxJob = jobs.find(
          (j) => String(j?.type) === 'pptx_generate' && String(j?.status) === 'completed',
        );
        if (pptxJob?.id) return String(pptxJob.id);
        const failed = jobs.find(
          (j) => String(j?.type) === 'pptx_generate' && String(j?.status) === 'failed',
        );
        if (failed) {
          throw new Error(`pptx_generate job failed: ${JSON.stringify(failed?.error ?? failed)}`);
        }
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(`No completed pptx_generate job within ${timeoutMs}ms`);
  };

  test('generates a PPTX via document_generate and serves it on the download route', async ({
    browser,
  }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

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
    await userAApi.dispose();

    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();

    try {
      // Chat from the organization detail page so the freeform document_generate
      // entity (organization) is resolved from the primary context automatically.
      await page.goto(`/organizations/${orgId}`);
      await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 15_000 });
      await page.waitForLoadState('domcontentloaded');
      await page
        .waitForResponse(
          (res) =>
            res.url().includes(`/api/v1/organizations/${orgId}`) &&
            res.status() === 200,
          { timeout: 10_000 },
        )
        .catch(() => {});

      const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
      await expect(chatButton).toBeVisible({ timeout: 10_000 });
      await chatButton.click();
      const composer = page.locator('[role="textbox"][aria-label="Composer"]');
      await expect(composer).toBeVisible({ timeout: 10_000 });

      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      // Explicit instruction to use the PPTX format of document_generate.
      await page.keyboard.type(
        'Use the document_generate tool with format "pptx" to create a one-slide presentation titled "' +
          orgName +
          '" summarizing this organization. Keep it minimal.',
      );

      const [sendResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.request().method() === 'POST' &&
            res.url().includes('/api/v1/chat/messages'),
          { timeout: 30_000 },
        ),
        page.keyboard.press('Enter'),
      ]);
      expect(sendResponse.status()).toBeLessThan(400);

      // Wait for the AI run to produce a completed pptx_generate job (contract proof).
      const jobId = await pollForCompletedPptxJob(page, workspaceId);
      expect(jobId).toBeTruthy();

      // Contract assertion: the download route returns 200 + a PPTX content-type.
      const downloadRes = await page.request.get(
        `${API_BASE_URL}/api/v1/pptx/jobs/${encodeURIComponent(jobId)}/download?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect(downloadRes.status()).toBe(200);
      const contentType = downloadRes.headers()['content-type'] ?? '';
      expect(contentType).toContain(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      const body = await downloadRes.body();
      // A real .pptx is a ZIP container; first bytes are "PK".
      expect(body.length).toBeGreaterThan(0);
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    } finally {
      await context.close();
    }
  });
});
