import { test, expect } from '@playwright/test';

// UX: on mobile, the chat is docked full screen (100vw). When navigating from the burger menu,
// the chat should auto-close so the destination page is visible.
test.describe.serial('Chat (mobile docked) — navigation closes chat', () => {
  test('devrait fermer le chat docké (mobile) après clic sur un item du menu burger', async ({ page }) => {
    // Mobile viewport to force docked full-screen
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 10_000 });

    // Open chat
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // Open burger menu from chat header (visible only in docked+mobile)
    const burgerInChatHeader = page.locator('button[aria-label="Menu"]').first();
    await expect(burgerInChatHeader).toBeVisible({ timeout: 10_000 });
    await burgerInChatHeader.click();

    // Click a navigation item (Organisations)
    const orgLink = page.locator('a[href="/organisations"]').first();
    await expect(orgLink).toBeVisible({ timeout: 10_000 });
    await orgLink.click();

    // The chat should close, and the destination should be visible
    await page.waitForURL(/\/organisations(?:[/?#]|$)/, { timeout: 10_000 });
    await expect(composer).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Organisations', { timeout: 10_000 });
  });
});


