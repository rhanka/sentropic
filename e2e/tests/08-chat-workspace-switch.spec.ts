import { test, expect, request } from '@playwright/test';

import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.setTimeout(240_000);

test.describe('Chat session/workspace switch', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';

  const chatButtonSelector = 'button[aria-controls="chat-widget-dialog"]';
  const composerSelector = '[role="textbox"][aria-label="Composer"]';
  const sessionMenuLabel =
    /choisir une conversation|choose (a )?(conversation|session)|session list|conversation list/i;
  const sessionNewLabel = /nouvelle session|new session/i;
  const sessionItemsSelector =
    'button.w-full.text-left.rounded:not([aria-label="Nouvelle session"]):not([aria-label="New session"])';

  type SessionFixture = {
    id: string;
    workspaceId: string;
    title: string;
    userContent: string;
    assistantContent: string;
  };

  async function createScopedPage(
    browser: import('@playwright/test').Browser,
    workspaceId: string,
  ) {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const page = await context.newPage();
    return { context, page };
  }

  async function openChat(page: import('@playwright/test').Page) {
    const chatButton = page.locator(chatButtonSelector);
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();
    await expect(page.locator('#chat-widget-dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(composerSelector)).toBeVisible({ timeout: 10_000 });
  }

  async function ensureSessionMenuOpen(page: import('@playwright/test').Page) {
    const sessionMenuButton = page.locator(
      '#chat-widget-dialog button[aria-label="Choisir une conversation"]:visible, #chat-widget-dialog button[aria-label="Choose a conversation"]:visible',
    ).first();
    await expect(sessionMenuButton).toBeVisible({ timeout: 5_000 });
    const sessionItems = page.locator(sessionItemsSelector);
    if (!(await sessionItems.first().isVisible().catch(() => false))) {
      await sessionMenuButton.click();
    }
    await expect(sessionItems.first()).toBeVisible({ timeout: 5_000 });
  }

  async function selectSessionByMarker(
    page: import('@playwright/test').Page,
    marker: string,
  ) {
    await ensureSessionMenuOpen(page);
    const sessionItem = page.locator(sessionItemsSelector).filter({ hasText: marker }).first();
    await expect(sessionItem).toBeVisible({ timeout: 10_000 });
    await sessionItem.click();
  }

  async function resolveWorkspaceRow(
    page: import('@playwright/test').Page,
    workspaceName: string,
  ) {
    const rowByName = page.locator('tbody tr').filter({ hasText: workspaceName }).first();
    await expect(rowByName).toBeVisible({ timeout: 10_000 });
    return rowByName;
  }

  test('switches chat sessions inside one workspace and clears stale session state when changing workspace', async ({
    browser,
  }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspaceAName = `Chat Switch A ${Date.now()}`;
    const workspaceBName = `Chat Switch B ${Date.now()}`;
    const workspaceARes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceAName },
    });
    const workspaceBRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: workspaceBName },
    });
    expect(workspaceARes.ok()).toBeTruthy();
    expect(workspaceBRes.ok()).toBeTruthy();

    const workspaceA = await workspaceARes.json().catch(() => null);
    const workspaceB = await workspaceBRes.json().catch(() => null);
    const workspaceAId = String(workspaceA?.id ?? '');
    const workspaceBId = String(workspaceB?.id ?? '');
    expect(workspaceAId).toBeTruthy();
    expect(workspaceBId).toBeTruthy();

    const sessionAOnePrompt = `ALPHA-ONE-${Date.now()}`;
    const sessionATwoPrompt = `ALPHA-TWO-${Date.now()}`;
    const sessionBPrompt = `BRAVO-ONE-${Date.now()}`;
    const sessionFixtures: SessionFixture[] = [
      {
        id: `session-a1-${Date.now()}`,
        workspaceId: workspaceAId,
        title: sessionAOnePrompt,
        userContent: `Réponds uniquement avec RESP-ALPHA-ONE. ${sessionAOnePrompt}`,
        assistantContent: 'RESP-ALPHA-ONE',
      },
      {
        id: `session-a2-${Date.now()}`,
        workspaceId: workspaceAId,
        title: sessionATwoPrompt,
        userContent: `Réponds uniquement avec RESP-ALPHA-TWO. ${sessionATwoPrompt}`,
        assistantContent: 'RESP-ALPHA-TWO',
      },
      {
        id: `session-b1-${Date.now()}`,
        workspaceId: workspaceBId,
        title: sessionBPrompt,
        userContent: `Réponds uniquement avec RESP-BRAVO-ONE. ${sessionBPrompt}`,
        assistantContent: 'RESP-BRAVO-ONE',
      },
    ];
    const sessionById = new Map(sessionFixtures.map((session) => [session.id, session]));

    const { context, page } = await createScopedPage(browser, workspaceAId);
    try {
      await page.route(/\/api\/v1\/chat\/sessions(?:\/[^/]+\/history)?(?:\?.*)?$/, async (route) => {
        const url = new URL(route.request().url());
        const match = url.pathname.match(/\/api\/v1\/chat\/sessions\/([^/]+)\/history$/);
        if (match) {
          const session = sessionById.get(match[1]);
          if (!session) {
            await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
            return;
          }
          const lines = [
            JSON.stringify({ type: 'session_meta', sessionId: session.id, title: session.title, checkpoints: [], documents: [] }),
            JSON.stringify({
              type: 'timeline_item',
              item: {
                kind: 'message',
                key: `${session.id}:user`,
                message: {
                  id: `${session.id}:user`,
                  sessionId: session.id,
                  role: 'user',
                  content: session.userContent,
                  sequence: 1,
                  createdAt: '2026-03-11T00:00:00.000Z',
                },
              },
            }),
            JSON.stringify({
              type: 'timeline_item',
              item: {
                kind: 'message',
                key: `${session.id}:assistant`,
                message: {
                  id: `${session.id}:assistant`,
                  sessionId: session.id,
                  role: 'assistant',
                  content: session.assistantContent,
                  model: 'gpt-4.1-nano',
                  sequence: 2,
                  createdAt: '2026-03-11T00:00:01.000Z',
                },
              },
            }),
          ].join('\n');
          await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: `${lines}\n` });
          return;
        }

        const workspaceId = url.searchParams.get('workspace_id') ?? '';
        const sessions = sessionFixtures
          .filter((session) => session.workspaceId === workspaceId)
          .map((session) => ({
            id: session.id,
            title: session.title,
            createdAt: '2026-03-11T00:00:00.000Z',
            updatedAt: '2026-03-11T00:00:01.000Z',
          }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessions }),
        });
      });

      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);

      await selectSessionByMarker(page, sessionAOnePrompt);
      await expect(
        page
          .locator('#chat-widget-dialog div.rounded.bg-white.border.border-slate-200')
          .filter({ hasText: 'RESP-ALPHA-ONE' })
          .last(),
      ).toBeVisible({ timeout: 20_000 });

      await selectSessionByMarker(page, sessionATwoPrompt);
      await expect(
        page
          .locator('#chat-widget-dialog div.rounded.bg-white.border.border-slate-200')
          .filter({ hasText: 'RESP-ALPHA-TWO' })
          .last(),
      ).toBeVisible({ timeout: 20_000 });

      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      const workspaceBRow = await resolveWorkspaceRow(page, workspaceBName);
      await workspaceBRow.click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('workspaceScopeId')), {
          timeout: 10_000,
        })
        .toBe(workspaceBId);

      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await openChat(page);
      await ensureSessionMenuOpen(page);

      await expect(
        page.locator(sessionItemsSelector).filter({ hasText: sessionBPrompt }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator(sessionItemsSelector).filter({ hasText: sessionAOnePrompt }),
      ).toHaveCount(0);
      await expect(
        page.locator(sessionItemsSelector).filter({ hasText: sessionATwoPrompt }),
      ).toHaveCount(0);
    } finally {
      await context.close();
      await userAApi.dispose();
    }
  });
});
