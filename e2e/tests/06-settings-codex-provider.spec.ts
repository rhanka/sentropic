import { expect, test } from '@playwright/test';

test.describe('Codex provider settings', () => {
  test.use({ storageState: './.auth/state.json' });

  test('admin can follow a mocked Codex device flow from settings', async ({ page }) => {
    let openaiTransportMode: 'codex' | 'token' = 'token';
    const postedModes: string[] = [];
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

    await page.route(/\/api\/v1\/settings\/provider-connections(?:\/openai\/mode|\/codex\/enrollment\/(?:start|complete|disconnect))?(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      const method = route.request().method();

      if (pathname.endsWith('/openai/mode') && method === 'POST') {
        const payload = route.request().postDataJSON() as { mode?: string } | undefined;
        openaiTransportMode = payload?.mode === 'codex' ? 'codex' : 'token';
        postedModes.push(openaiTransportMode);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mode: openaiTransportMode }),
        });
        return;
      }

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
          openaiTransportMode,
          providers: [
            providerState,
            {
              providerId: 'openai',
              label: 'OpenAI',
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
    const openAiKeyButton = page.getByRole('button', { name: /OpenAI key/i });
    const codexTokenButton = page.getByRole('button', { name: /Codex token/i });
    await expect(openAiKeyButton).toBeVisible();
    await expect(codexTokenButton).toBeDisabled();

    await page.getByLabel(/Codex account label|Libellé compte Codex/i).fill('admin@example.com');
    await page.getByRole('button', { name: /Start sign-in|Démarrer la connexion/i }).click();

    await expect(page.getByText(/ABCD-EFGH/)).toBeVisible();
    await expect(page.getByRole('link', { name: /https:\/\/auth\.openai\.com\/codex\/device/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Regenerate code|Régénérer le code/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Cancel|Annuler/i }),
    ).toBeVisible();
    await page.waitForTimeout(4500);

    await expect(page.getByText('admin@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('Prêt', { exact: true })).toBeVisible();
    await expect(codexTokenButton).toBeEnabled();

    await codexTokenButton.click();
    await expect(openAiKeyButton).toBeEnabled();
    expect(postedModes).toEqual(['codex']);

    await openAiKeyButton.click();
    expect(postedModes).toEqual(['codex', 'token']);

    await page.getByRole('button', { name: /Disconnect|Déconnecter/i }).click();
    await expect(page.getByText('Non prêt', { exact: true }).first()).toBeVisible();
  });
});
