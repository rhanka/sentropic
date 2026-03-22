import { test, expect } from '@playwright/test';

test.describe('Chrome extension auth chrome-specific UX', () => {
  const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost:5173';
  const EXTENSION_API_BASE_URL = new URL('/api/v1', UI_BASE_URL).toString().replace(/\/$/, '');
  const chatButtonSelector =
    'button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]';
  const extensionSettingsButtonSelector = 'button[aria-label="Paramètres de l’extension"]';

  async function mockChromeExtensionRuntime(page: any) {
    await page.addInitScript(({ apiBaseUrl, appBaseUrl }) => {
      const state = {
        config: {
          profile: 'uat',
          apiBaseUrl,
          appBaseUrl,
          wsBaseUrl: '',
          sessionToken: '',
          updatedAt: Date.now(),
        },
        authUser: {
          id: 'e2e-extension-user',
          email: 'e2e-extension@example.com',
          displayName: 'E2E Extension',
          role: 'admin_app',
        },
      };

      const sendMessage = async (message: any) => {
        const type = String(message?.type ?? '');
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
        if (type === 'extension_active_tab_context_get') {
          return {
            ok: true,
            tab: {
              tabId: 101,
              url: 'https://example.com/search?q=top-ai',
              origin: 'https://example.com',
              title: 'Example Search',
            },
          };
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
    }, { apiBaseUrl: EXTENSION_API_BASE_URL, appBaseUrl: UI_BASE_URL });
  }

  test('does not expose VSCode token bootstrap wording in Chrome host', async ({ page }) => {
    await mockChromeExtensionRuntime(page);
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator(chatButtonSelector);
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    await expect(
      page.getByText('Un token extension est requis avant d’utiliser cette zone.'),
    ).toHaveCount(0);

    const settingsButton = page.locator(extensionSettingsButtonSelector);
    await expect(settingsButton).toBeVisible({ timeout: 10_000 });
    await settingsButton.click();

    await expect(page.locator('input[placeholder="tok_..."]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Déconnecter' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Valider le token' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vider la session' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ouvrir la connexion' })).toHaveCount(0);
  });
});
