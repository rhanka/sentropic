import { expect, test } from '@playwright/test';

test.describe('Codex provider settings', () => {
  test.use({ storageState: './.auth/state.json' });

  test('admin can complete a mocked Codex device flow from settings', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => null;
    });

    let providerState = {
      providerId: 'codex',
      label: 'Codex',
      ready: false,
      connectionStatus: 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
      managedBy: 'none',
      accountLabel: 'mock-admin@example.com',
      updatedAt: null,
      updatedByUserId: null,
      canConfigure: true,
    };

    await page.route(/\/api\/v1\/settings\/provider-connections(?:\/codex\/enrollment\/(?:start|complete|disconnect))?(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;

      if (pathname.endsWith('/codex/enrollment/start')) {
        providerState = {
          ...providerState,
          connectionStatus: 'pending',
          enrollmentId: 'enroll_1',
          enrollmentUrl: 'https://auth.openai.com/codex/device',
          enrollmentCode: 'ABCD-EFGH',
          accountLabel: 'admin@example.com',
          updatedAt: '2026-03-09T20:00:00.000Z',
          updatedByUserId: 'admin-user',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ provider: providerState }),
        });
        return;
      }

      if (pathname.endsWith('/codex/enrollment/complete')) {
        providerState = {
          ...providerState,
          ready: true,
          connectionStatus: 'connected',
          enrollmentId: null,
          enrollmentUrl: null,
          enrollmentCode: null,
          managedBy: 'admin_settings',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ provider: providerState }),
        });
        return;
      }

      if (pathname.endsWith('/codex/enrollment/disconnect')) {
        providerState = {
          ...providerState,
          ready: false,
          connectionStatus: 'disconnected',
          enrollmentId: null,
          enrollmentUrl: null,
          enrollmentCode: null,
          managedBy: 'none',
          accountLabel: null,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ provider: providerState }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            providerState,
            {
              providerId: 'openai',
              label: 'OpenAI',
              ready: providerState.ready,
              connectionStatus: providerState.ready ? 'connected' : 'disconnected',
              enrollmentId: null,
              enrollmentUrl: null,
              enrollmentCode: null,
              enrollmentExpiresAt: null,
              managedBy: providerState.ready ? 'admin_settings' : 'none',
              accountLabel: providerState.ready ? 'admin@example.com' : null,
              updatedAt: null,
              updatedByUserId: null,
              canConfigure: false,
            },
            {
              providerId: 'gemini',
              label: 'Gemini',
              ready: false,
              connectionStatus: 'disconnected',
              enrollmentId: null,
              enrollmentUrl: null,
              enrollmentCode: null,
              enrollmentExpiresAt: null,
              managedBy: 'none',
              accountLabel: null,
              updatedAt: null,
              updatedByUserId: null,
              canConfigure: false,
            },
          ],
        }),
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: /Connexions providers|Provider connections/i })).toBeVisible();
    await expect(page.getByText('mock-admin@example.com')).toBeVisible();

    await page.getByLabel(/Codex account label|Libellé compte Codex/i).fill('admin@example.com');
    await page.getByRole('button', { name: /Start sign-in|Démarrer la connexion/i }).click();

    await expect(page.getByText(/ABCD-EFGH/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Open OpenAI device page|Ouvrir la page device OpenAI/i }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Finalize sign-in|Finaliser la connexion/i }).click();

    await expect(page.getByText('admin@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('Prêt', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Disconnect|Déconnecter/i }).click();
    await expect(page.getByText('Non prêt', { exact: true }).first()).toBeVisible();
  });
});
