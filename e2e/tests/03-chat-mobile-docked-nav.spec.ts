import { test, expect } from '@playwright/test';

// UX: on mobile, the chat is docked full screen (100vw). When navigating from the burger menu,
// the chat should auto-close so the destination page is visible.
test.describe('Chat (mobile docked) — navigation closes chat', () => {
  test('devrait fermer le chat docké (mobile) après clic sur un item du menu burger', async ({ page }) => {
    // Mobile viewport to force docked full-screen
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 10_000 });

    // Open chat
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
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
    await page.waitForURL(/\/organizations(?:[/?#]|$)/, { timeout: 10_000 });
    await expect(composer).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Organisations', { timeout: 10_000 });
  });
});

test.describe('Chat placement menu — desktop geometry', () => {
  test('places Left, Center, and Right against the desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    const moveTrigger = chatDialog.getByRole('button', { name: 'Move chat to…' });
    await expect(moveTrigger).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Desktop viewport is unavailable');

    const selectPlacement = async (label: 'Left' | 'Center' | 'Right', className: RegExp) => {
      await moveTrigger.click();
      const menu = page.getByRole('menu', { name: 'Move chat to…' });
      await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
      await expect(chatDialog).toHaveClass(className);
      const box = await chatDialog.boundingBox();
      if (!box) throw new Error(`Chat dialog has no bounding box after selecting ${label}`);
      return box;
    };

    const left = await selectPlacement('Left', /sm:left-4/);
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(left.x).toBeLessThanOrEqual(24);
    expect(left.x + left.width).toBeLessThanOrEqual(viewport.width);

    const center = await selectPlacement('Center', /sm:left-1\/2/);
    expect(Math.abs(center.x + center.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);

    const right = await selectPlacement('Right', /sm:right-4/);
    expect(viewport.width - (right.x + right.width)).toBeGreaterThanOrEqual(0);
    expect(viewport.width - (right.x + right.width)).toBeLessThanOrEqual(24);
  });
});
