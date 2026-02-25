import { test, expect } from '@playwright/test';

test.describe.serial('Chat extension evolutions', () => {
  const chatButtonSelector =
    'button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]';
  const composerSelector = '[role="textbox"][aria-label="Composer"]';

  async function sendMessageAndWaitApi(page: any, composer: any, message: string) {
    const editable = page
      .locator(
        '[role="textbox"][aria-label="Composer"][contenteditable="true"]:visible, [role="textbox"][aria-label="Composer"]:visible [contenteditable="true"]:visible'
      )
      .first();
    await expect(editable).toBeVisible({ timeout: 5_000 });
    await editable.focus();
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
      requestBody = JSON.parse(req.postData() || '{}');
    } catch {
      requestBody = null;
    }
    const data = await res.json().catch(() => null);
    return {
      requestBody,
      sessionId: String((data as any)?.sessionId ?? ''),
    };
  }

  async function mockExtensionRuntime(page: any) {
    await page.addInitScript(() => {
      const state = {
        config: {
          profile: 'uat',
          apiBaseUrl: 'http://localhost:8787/api/v1',
          appBaseUrl: 'http://localhost:5173',
          wsBaseUrl: '',
          updatedAt: Date.now(),
        },
        permissions: [] as Array<{
          toolName: string;
          origin: string;
          policy: 'allow' | 'deny';
          updatedAt: string;
        }>,
        authUser: {
          id: 'e2e-extension-user',
          email: 'e2e-extension@example.com',
          displayName: 'E2E Extension',
          role: 'admin_app',
        },
        activeTab: {
          tabId: 101,
          url: 'https://example.com/search?q=top-ai',
          origin: 'https://example.com',
          title: 'Example Search',
        },
      };

      const sendMessage = async (message: any) => {
        const type = String(message?.type ?? '');
        if (type === 'extension_active_tab_context_get') {
          return { ok: true, tab: state.activeTab };
        }
        if (type === 'extension_auth_status') {
          return { ok: true, status: { connected: true, user: state.authUser } };
        }
        if (type === 'extension_auth_connect') {
          return { ok: true, user: state.authUser };
        }
        if (type === 'extension_auth_logout' || type === 'extension_auth_open_login') {
          return { ok: true };
        }
        if (type === 'extension_config_get') {
          return { ok: true, config: state.config };
        }
        if (type === 'extension_config_set') {
          const payload = message?.payload ?? {};
          state.config = {
            ...state.config,
            ...payload,
            updatedAt: Date.now(),
          };
          return { ok: true, config: state.config };
        }
        if (type === 'extension_config_test') {
          return { ok: true, status: 200 };
        }
        if (type === 'extension_tool_permissions_list') {
          return { ok: true, items: state.permissions };
        }
        if (type === 'extension_tool_permissions_upsert') {
          const payload = message?.payload ?? {};
          const toolName = String(payload.toolName ?? '');
          const origin = String(payload.origin ?? '');
          const policy = payload.policy === 'deny' ? 'deny' : 'allow';
          const updatedAt = new Date().toISOString();
          const next = { toolName, origin, policy, updatedAt };
          const idx = state.permissions.findIndex(
            (entry) => entry.toolName === toolName && entry.origin === origin,
          );
          if (idx >= 0) state.permissions[idx] = next;
          else state.permissions.push(next);
          return { ok: true, item: next };
        }
        if (type === 'extension_tool_permissions_delete') {
          const payload = message?.payload ?? {};
          const toolName = String(payload.toolName ?? '');
          const origin = String(payload.origin ?? '');
          state.permissions = state.permissions.filter(
            (entry) => !(entry.toolName === toolName && entry.origin === origin),
          );
          return { ok: true };
        }
        if (type === 'tool_permission_decide') {
          return { ok: true };
        }
        if (type === 'tool_execute') {
          return { ok: true, result: { status: 'completed' } };
        }
        if (type === 'open_side_panel') {
          return { ok: true };
        }
        return { ok: true };
      };

      const existingChrome = (globalThis as any).chrome ?? {};
      const existingRuntime = existingChrome.runtime ?? {};
      (globalThis as any).chrome = {
        ...existingChrome,
        runtime: {
          ...existingRuntime,
          id: 'e2e-extension-runtime',
          sendMessage,
        },
      };
    });
  }

  test('new session restricts visible tools to web + local tab scope in extension runtime', async ({ page }) => {
    await mockExtensionRuntime(page);
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator(chatButtonSelector);
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const composer = page.locator(composerSelector);
    await expect(composer).toBeVisible({ timeout: 10_000 });

    const commentsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Commentaires$/i });
    await expect(commentsTab).toHaveCount(0);

    const menuButton = page.locator('button[aria-label="Ouvrir le menu"]');
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await menuButton.click();

    const menu = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu).toContainText('Onglet actif:');
    await expect(menu.locator('button', { hasText: 'Web search' })).toBeVisible({ timeout: 10_000 });
    await expect(menu.locator('button', { hasText: 'Web extract' })).toBeVisible({ timeout: 10_000 });
    await expect(menu.locator('button', { hasText: 'Onglet (lecture)' })).toBeVisible({ timeout: 10_000 });
    await expect(menu.locator('button', { hasText: 'Onglet (actions)' })).toBeVisible({ timeout: 10_000 });
    await expect(menu.locator('button', { hasText: 'Documents' })).toHaveCount(0);
    await expect(menu.locator('button', { hasText: 'Commentaires (résolution)' })).toHaveCount(0);
    await expect(menu.locator('button', { hasText: 'Organisation (lecture)' })).toHaveCount(0);
    await expect(menu.locator('button', { hasText: 'Dossier (lecture)' })).toHaveCount(0);
  });

  test('localToolDefinitions follows tab_read/tab_action toggles in extension runtime', async ({ page }) => {
    await mockExtensionRuntime(page);
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator(chatButtonSelector);
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const composer = page.locator(composerSelector);
    await expect(composer).toBeVisible({ timeout: 10_000 });

    const menuButton = page.locator('button[aria-label="Ouvrir le menu"]');
    await expect(menuButton).toBeVisible({ timeout: 10_000 });

    const firstRequest = await sendMessageAndWaitApi(
      page,
      composer,
      'Réponds uniquement avec OK_LOCAL_TOOLS_DEFAULT',
    );
    const firstNames = (firstRequest.requestBody?.localToolDefinitions ?? [])
      .map((entry: { name?: string }) => String(entry?.name ?? ''))
      .sort();
    expect(firstNames).toEqual(['tab_action', 'tab_read']);

    await menuButton.click();
    const menu = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    const tabActionToggle = menu.locator('button', { hasText: 'Onglet (actions)' }).first();
    await expect(tabActionToggle).toBeVisible({ timeout: 10_000 });
    await tabActionToggle.click();
    await menuButton.click();
    await expect(menu).not.toBeVisible({ timeout: 10_000 });
    await expect(composer).toBeVisible({ timeout: 10_000 });

    const secondRequest = await sendMessageAndWaitApi(
      page,
      composer,
      'Réponds uniquement avec OK_LOCAL_TOOLS_TAB_ACTION_OFF',
    );
    const secondNames = (secondRequest.requestBody?.localToolDefinitions ?? [])
      .map((entry: { name?: string }) => String(entry?.name ?? ''))
      .sort();
    expect(secondNames).toEqual(['tab_read']);
  });
});
