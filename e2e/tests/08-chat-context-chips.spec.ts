import { test, expect, request } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// AI-independent: the composer context picker resolves the seeded organization's
// human label (its name, not a UUID) from the org-detail route, and the send
// payload carries the context entry. POST /chat/messages is mocked so no model
// run is required.
test.setTimeout(120_000);

test.describe('Chat composer context chips', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  const chatButtonSelector = 'button[aria-controls="chat-widget-dialog"]';
  const composerSelector = '[role="textbox"][aria-label="Composer"]';

  const composerMenu = (page: import('@playwright/test').Page) =>
    page
      .locator('div.fixed.shadow-lg, div.absolute.shadow-lg')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();

  test('resolves a seeded organization context to a human label, sends it in the payload, and removes it', async ({
    browser,
  }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspaceName = `Context Chips ${Date.now()}`;
    const workspaceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceName },
    });
    expect(workspaceRes.ok()).toBeTruthy();
    const workspace = await workspaceRes.json().catch(() => null);
    const workspaceId = String(workspace?.id ?? '');
    expect(workspaceId).toBeTruthy();

    const orgName = `Acme Context Org ${Date.now()}`;
    const orgRes = await userAApi.post(
      `/api/v1/organizations?workspace_id=${workspaceId}`,
      { data: { name: orgName, data: { industry: 'Services' } } },
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

    // Mock the chat send so the spec never depends on an AI run; payload
    // assertions use the request returned by waitForRequest (not a side-channel
    // collected in the route callback, which races with waitForRequest).
    await page.route(/\/api\/v1\/chat\/messages(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId: `ctx-session-${Date.now()}`,
            jobId: 'job-ctx',
            streamId: 'stream-ctx',
            messageId: 'msg-ctx',
            assistantMessageId: 'amsg-ctx',
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      // Navigate to the organization detail page — the route adds the org as an
      // active context whose label is resolved to the org NAME (not a UUID).
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

      const chatButton = page.locator(chatButtonSelector);
      await expect(chatButton).toBeVisible({ timeout: 10_000 });
      await chatButton.click();
      const composer = page.locator(composerSelector);
      await expect(composer).toBeVisible({ timeout: 10_000 });

      const menuButton = page
        .getByRole('button', { name: /Ouvrir le menu|Open menu/i })
        .first();
      await menuButton.click();

      const menu = composerMenu(page);
      await expect(menu).toBeVisible({ timeout: 5_000 });

      // The chip renders the RESOLVED human label (the org name), not a UUID.
      const orgChip = menu.locator('button', { hasText: orgName }).first();
      await expect(orgChip).toBeVisible({ timeout: 10_000 });
      await expect(orgChip).not.toContainText(orgId);
      // Active chip uses text-slate-900 (inactive would be text-slate-400).
      await expect(orgChip).toHaveClass(/text-slate-900/);

      // Close the menu via its trigger toggle (Escape would close the whole
      // chat dialog — ChatWidget's dialog keydown handler catches it) and send
      // a message: the payload must carry the org context.
      await menuButton.click();
      await expect(menu).toBeHidden({ timeout: 5_000 });
      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.type('Message with org context');
      const [firstReq] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'POST' && req.url().includes('/api/v1/chat/messages'),
          { timeout: 15_000 },
        ),
        page.keyboard.press('Enter'),
      ]);

      const firstPayload = JSON.parse(firstReq.postData() || '{}') as Record<
        string,
        unknown
      >;
      expect(firstPayload.primaryContextType).toBe('organization');
      expect(firstPayload.primaryContextId).toBe(orgId);
      const contexts = Array.isArray(firstPayload.contexts)
        ? (firstPayload.contexts as Array<{ contextType: string; contextId: string }>)
        : [];
      expect(
        contexts.some(
          (entry) => entry.contextType === 'organization' && entry.contextId === orgId,
        ),
      ).toBeTruthy();

      // Now toggle the chip OFF and assert removal: re-open the menu, click the
      // chip to deactivate it, then a subsequent send no longer carries the context.
      await menuButton.click();
      const menu2 = composerMenu(page);
      await expect(menu2).toBeVisible({ timeout: 5_000 });
      const orgChip2 = menu2.locator('button', { hasText: orgName }).first();
      await expect(orgChip2).toBeVisible({ timeout: 5_000 });
      await orgChip2.click();
      // Deactivated chip switches to the inactive class.
      await expect(orgChip2).toHaveClass(/text-slate-400/, { timeout: 5_000 });

      await menuButton.click();
      await expect(menu2).toBeHidden({ timeout: 5_000 });
      await editable.click();
      await page.keyboard.type('Message without org context');
      const [secondReq] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'POST' && req.url().includes('/api/v1/chat/messages'),
          { timeout: 15_000 },
        ),
        page.keyboard.press('Enter'),
      ]);

      const secondPayload = JSON.parse(secondReq.postData() || '{}') as Record<
        string,
        unknown
      >;
      const contexts2 = Array.isArray(secondPayload.contexts)
        ? (secondPayload.contexts as Array<{ contextType: string; contextId: string }>)
        : [];
      expect(
        contexts2.some(
          (entry) => entry.contextType === 'organization' && entry.contextId === orgId,
        ),
      ).toBeFalsy();
    } finally {
      await context.close();
    }
  });
});
