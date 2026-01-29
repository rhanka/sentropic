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

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // Ouvrir le menu du ChatWidget (et surtout PAS le burger du header sous-jacent)
    // Le dialog du widget est identifié par l'id `chat-widget-dialog` (voir ChatWidget.svelte).
    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    const burgerInChatHeader = chatDialog.locator('button[aria-label="Menu"]').first();
    await expect(burgerInChatHeader).toBeVisible({ timeout: 10_000 });
    await burgerInChatHeader.click();

    // Click a navigation item (Organisations) dans le drawer (pas le header caché)
    const burgerDrawer = page.getByRole('complementary');
    await expect(burgerDrawer).toBeVisible({ timeout: 10_000 });
    const orgLink = burgerDrawer.getByRole('link', { name: 'Organisations' }).first();
    await expect(orgLink).toBeVisible({ timeout: 10_000 });
    await orgLink.click();

    // The chat should close, and the destination should be visible
    await page.waitForURL(/\/organisations(?:[/?#]|$)/, { timeout: 10_000 });
    await expect(composer).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Organisations', { timeout: 10_000 });
  });
});


