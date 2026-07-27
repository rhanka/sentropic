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
  test('places Panneau + Gauche flush left and Panneau + Droite flush right', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    const moveTrigger = chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' });
    await expect(moveTrigger).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Desktop viewport is unavailable');

    const select = async (label: 'Panneau' | 'Gauche' | 'Droite') => {
      await moveTrigger.click();
      const menu = page.getByRole('menu', { name: 'Déplacer le chat vers…' });
      await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
    };

    await select('Panneau');
    await select('Gauche');
    const left = await chatDialog.boundingBox();
    if (!left) throw new Error('Chat dialog has no bounding box after selecting Panneau + Gauche');
    expect(left.x).toBe(0);
    expect(left.x + left.width).toBeLessThan(viewport.width);

    await select('Droite');
    const right = await chatDialog.boundingBox();
    if (!right) throw new Error('Chat dialog has no bounding box after selecting Panneau + Droite');
    expect(right.x).toBeGreaterThan(0);
    expect(right.x + right.width).toBe(viewport.width);
  });

  test('drags the header Move control to the left panel drop zone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const chatDialog = page.locator('#chat-widget-dialog');
    const moveTrigger = chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' });
    await expect(moveTrigger).toBeVisible();
    const triggerBox = await moveTrigger.boundingBox();
    if (!triggerBox) throw new Error('Move trigger has no bounding box');

    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(80, 200);
    await expect(page.locator('[data-chat-placement-drop-zones]')).toBeVisible();
    await page.mouse.up();

    const box = await chatDialog.boundingBox();
    if (!box) throw new Error('Chat dialog has no bounding box after a left-panel drag');
    expect(box.x).toBe(0);

    await expect(page.locator('[data-chat-placement-drop-zones]')).toHaveCount(0);
  });
});

test.describe('Chat placement menu — host ownership', () => {
  test('renders only in an ordinary desktop overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    const moveTrigger = chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' });
    await expect(moveTrigger).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(moveTrigger).toHaveCount(0);
  });
});

test.describe('Chat placement menu — legacy display-mode integration', () => {
  test('seeds a legacy docked preference and mirrors a floating menu choice back to legacy storage', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('chatWidgetDisplayMode', 'docked');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('chat-ui/placement/v1/')) localStorage.removeItem(key);
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();

    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    const seededBox = await chatDialog.boundingBox();
    if (!seededBox) throw new Error('Chat dialog has no bounding box for the legacy docked seed');
    expect(seededBox.x + seededBox.width).toBe(1440);

    await chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' }).click();
    const menu = page.getByRole('menu', { name: 'Déplacer le chat vers…' });
    await menu.getByRole('menuitemradio', { name: 'Libre', exact: true }).click();
    await chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' }).click();
    await page.getByRole('menu', { name: 'Déplacer le chat vers…' })
      .getByRole('menuitemradio', { name: 'Gauche', exact: true }).click();

    const floatingLeftBox = await chatDialog.boundingBox();
    if (!floatingLeftBox) throw new Error('Chat dialog has no bounding box after selecting Libre + Gauche');
    expect(floatingLeftBox.x).toBeGreaterThanOrEqual(0);
    expect(floatingLeftBox.x).toBeLessThanOrEqual(24);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('chatWidgetDisplayMode')))
      .toBe('floating');
  });
});
