import { test, expect, request } from '@playwright/test';
import path from 'node:path';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// Keep a generous timeout for upload + summarization + tool execution flow.
test.setTimeout(180_000);

test.describe.serial('Chat heavy flows', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_STATE = './.auth/state.json';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_A_EMAIL = 'e2e-user-a@example.com';

  const assistantWrapper = (page: any) => page.locator('div.flex.justify-start');
  const assistantBubble = (page: any) =>
    assistantWrapper(page).locator('div.rounded.bg-white.border.border-slate-200');

  async function sendMessageAndWaitApi(page: any, composer: any, message: string) {
    const editable = composer.locator('[contenteditable="true"]');
    await editable.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(message);
    const [req, res] = await Promise.all([
      page.waitForRequest(
        (request: any) => request.method() === 'POST' && request.url().includes('/api/v1/chat/messages'),
        { timeout: 30_000 }
      ),
      page.waitForResponse((response: any) => {
        const r = response.request();
        return r.method() === 'POST' && response.url().includes('/api/v1/chat/messages');
      }, { timeout: 30_000 }),
      page.keyboard.press('Enter')
    ]);

    const data = await res.json().catch(() => null);
    let requestBody: any = null;
    try {
      requestBody = JSON.parse(req.postData() || '{}');
    } catch {
      requestBody = null;
    }
    return {
      requestBody,
      jobId: String((data as any)?.jobId ?? ''),
      streamId: String((data as any)?.streamId ?? ''),
    };
  }

  async function debugBackendState(page: any, jobId: string, streamId: string) {
    try {
      if (jobId) {
        const jobRes = await page.request.get(`/api/v1/queue/jobs/${encodeURIComponent(jobId)}`);
        console.log('[08-chat-heavy] job status:', jobRes.status(), await jobRes.text());
      }
    } catch (error) {
      console.log('[08-chat-heavy] failed to fetch job status:', error);
    }
    try {
      if (streamId) {
        const eventsRes = await page.request.get(`/api/v1/streams/events/${encodeURIComponent(streamId)}?limit=50`);
        console.log('[08-chat-heavy] stream events:', eventsRes.status(), await eventsRes.text());
      }
    } catch (error) {
      console.log('[08-chat-heavy] failed to fetch stream events:', error);
    }
  }

  async function debugAssistantState(page: any) {
    try {
      const wrappers = assistantWrapper(page);
      console.log('[08-chat-heavy] assistant wrappers count:', await wrappers.count());
      console.log('[08-chat-heavy] assistant wrappers tail:', (await wrappers.allTextContents()).slice(-3));
      console.log('[08-chat-heavy] assistant bubbles tail:', (await assistantBubble(page).allTextContents()).slice(-5));
    } catch (error) {
      console.log('[08-chat-heavy] failed to dump assistant state:', error);
    }
  }

  test('devrait permettre upload + résumé + usage tool + suppression en viewer', async ({ browser }) => {
    const adminApi = await request.newContext({ baseURL: API_BASE_URL, storageState: ADMIN_STATE });
    const workspacesRes = await adminApi.get('/api/v1/workspaces');
    expect(workspacesRes.ok()).toBeTruthy();
    const workspacesData = await workspacesRes.json().catch(() => null);
    const adminWorkspace = (workspacesData?.items ?? []).find((w: { name?: string }) => w.name === 'Admin Workspace');
    const adminWorkspaceId = String(adminWorkspace?.id ?? '');
    expect(adminWorkspaceId).toBeTruthy();

    const addMemberRes = await adminApi.post(`/api/v1/workspaces/${adminWorkspaceId}/members`, {
      data: { email: USER_A_EMAIL, role: 'viewer' },
    });
    expect(addMemberRes.ok()).toBeTruthy();
    await adminApi.dispose();

    const userContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, adminWorkspaceId),
    });
    const page = await userContext.newPage();

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1_000 });

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1_000 });
    await chatButton.click();
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1_000 });

    const menuButton = page.locator('button[aria-label="Ouvrir le menu"]');
    await menuButton.click();
    const menu = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    const fileInput = menu.locator('input[type="file"]');
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/README.md');
    await fileInput.setInputFiles(fixturePath);
    await expect(page.locator('div.absolute').filter({ hasText: 'Contexte(s)' })).toHaveCount(0);

    const docRow = page
      .locator('div', { hasText: 'README.md' })
      .filter({ has: page.locator('button[aria-label="Supprimer le document"]') })
      .first();
    await expect(docRow).toBeVisible({ timeout: 15_000 });
    await expect(docRow).toContainText(/En attente|Analyse en cours|Résumé en cours|Résumé prêt|Pending|Summarizing|Summary ready/);
    await expect(docRow).toContainText('Résumé prêt', { timeout: 90_000 });

    const { jobId, streamId } = await sendMessageAndWaitApi(
      page,
      composer,
      'Liste les documents de la session et cite leur nom.'
    );
    const assistantResponse = assistantBubble(page).filter({ hasText: 'README.md' }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (error) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw error;
    }

    await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'DELETE' && res.url().includes('/api/v1/documents/');
      }, { timeout: 30_000 }),
      docRow.locator('button[aria-label="Supprimer le document"]').click(),
    ]);
    await expect(docRow).toHaveCount(0);

    await userContext.close();
  });
});
