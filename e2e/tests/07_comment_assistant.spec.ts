import { test, expect, request } from '@playwright/test';
test.setTimeout(180_000);

test.describe.serial('Comment assistant', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const AI_SEEDED_COMMENT = 'E2E AI comment on folder A (tool call).';
  const FOLDER_ID = 'e2e-folder-a';

  const workspaceId = 'e2e-ws-a';
  const useCaseId = 'e2e-uc-a-1';

  async function sendMessageAndCaptureTools(page: any, composer: any, message: string) {
    const editable = composer.locator('[contenteditable="true"]');
    await editable.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(message);
    const [req, res] = await Promise.all([
      page.waitForRequest((req: any) => req.method() === 'POST' && req.url().includes('/api/v1/chat/messages'), {
        timeout: 30_000
      }),
      page.waitForResponse((res: any) => {
        const r = res.request();
        return r.method() === 'POST' && res.url().includes('/api/v1/chat/messages');
      }, { timeout: 30_000 }),
      page.keyboard.press('Enter')
    ]);
    let requestBody: any = null;
    try {
      const raw = req.postData() || '{}';
      requestBody = JSON.parse(raw);
    } catch {
      requestBody = null;
    }
    const data = await res.json().catch(() => null);
    return {
      requestBody,
      jobId: String((data as any)?.jobId ?? ''),
      streamId: String((data as any)?.streamId ?? ''),
    };
  }

  async function selectThreadByLabel(widget: any, label: string) {
    const menuButton = widget.locator('button[aria-label="Choisir une conversation"]');
    await menuButton.click();
    const threadList = widget.locator('div.max-h-56');
    const targetThread = threadList.locator('button').filter({ hasText: label }).first();
    if (await targetThread.isVisible().catch(() => false)) {
      await targetThread.click();
      return;
    }
    const firstThread = threadList.locator('button').first();
    if (await firstThread.isVisible().catch(() => false)) {
      await firstThread.click();
    }
  }

  test.use({ storageState: USER_A_STATE });

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'commenter' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en commenter (status ${addRes.status()})`);
    }

    await userAApi.dispose();
  });

  test('tool activé par défaut + payload tools inclut comment_assistant', async ({ page }) => {
    await page.goto('/folders');
    await page.evaluate((wsId) => {
      try {
        localStorage.setItem('workspaceScopeId', wsId);
      } catch {
        // ignore
      }
    }, workspaceId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(`/usecase/${encodeURIComponent(useCaseId)}`);
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      try {
        localStorage.removeItem('chat_session_prefs:new');
      } catch {
        // ignore
      }
    });

    const chatButton = page.locator(
      'button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]'
    );
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const widget = page.locator('#chat-widget-dialog');
    await expect(widget).toBeVisible({ timeout: 10_000 });
    await widget.locator('button').filter({ hasText: /^Chat(?: IA)?$/i }).click();

    const composer = widget.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 10_000 });
    const { requestBody } = await sendMessageAndCaptureTools(page, composer, 'Teste les tools disponibles');

    const tools = Array.isArray(requestBody?.tools) ? requestBody.tools : [];
    expect(tools).toContain('comment_assistant');
  });

  test('IA poste un commentaire + badge Assistant IA', async ({ browser }) => {
    const pageBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageB = await pageBContext.newPage();
    await pageB.goto('/folders');
    await pageB.evaluate((wsId) => {
      try {
        localStorage.setItem('workspaceScopeId', wsId);
      } catch {
        // ignore
      }
    }, workspaceId);
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.goto(`/folders/${encodeURIComponent(FOLDER_ID)}`);
    await pageB.waitForLoadState('domcontentloaded');

    const descriptionSection = pageB.locator('[data-comment-section="description"]');
    await expect(descriptionSection).toBeVisible({ timeout: 10_000 });
    await descriptionSection.hover();
    const commentButton = descriptionSection.locator('button[aria-label="Commentaires"]');
    await commentButton.click({ force: true });

    const widgetB = pageB.locator('#chat-widget-dialog');
    await expect(widgetB).toBeVisible({ timeout: 10_000 });
    await widgetB.locator('button:has-text("Commentaires")').click();
    await selectThreadByLabel(widgetB, 'Contexte');

    await expect(widgetB.locator(`text=${AI_SEEDED_COMMENT}`)).toBeVisible({ timeout: 10_000 });
    await expect(widgetB.locator('text=Assistant IA').first()).toBeVisible({ timeout: 10_000 });

    await pageBContext.close();
  });
});
