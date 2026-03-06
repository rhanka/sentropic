import { expect, test } from '@playwright/test';

test.describe.serial('Dev chat bootstrap reload', () => {
  test('reload conserves reasoning/tools history without legacy stream-events calls', async ({ page }) => {
    const legacyRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/api/v1/chat/sessions/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (
        url.includes('/api/v1/chat/messages/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (url.includes('/api/v1/streams/events/')) {
        legacyRequests.push(url);
      }
    });

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 15_000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 15_000 });

    await composer.fill(
      'Avant de répondre, raisonne par étapes, utilise les outils si utile, puis explique brièvement les éléments visibles de la page.',
    );
    await page.getByTestId('chat-composer-send-button').click();

    const runtimeHeader = page
      .locator('#chat-widget-dialog')
      .getByText(/Raisonnement|Reasoning/i)
      .first();
    await expect(runtimeHeader).toBeVisible({ timeout: 60_000 });

    const retryButton = page
      .getByRole('button', { name: /réessayer|retry/i })
      .last();
    await expect(retryButton).toBeVisible({ timeout: 90_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(chatButton).toBeVisible({ timeout: 15_000 });
    await chatButton.click();
    await expect(runtimeHeader).toBeVisible({ timeout: 20_000 });

    expect(legacyRequests).toEqual([]);
  });
});
