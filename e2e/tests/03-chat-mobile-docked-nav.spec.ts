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
  test('keeps the app content pane clear of Panneau + Gauche and Panneau + Droite', async ({ page }) => {
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

    // The app pane animates its padding over 200ms, so a bare boundingBox()
    // read right after the click samples a mid-transition position. Poll the
    // measured geometry until it settles, then assert the invariant — this
    // still fails if the pane never clears the drawer.
    const settledBoxes = async () => {
      let previous = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const dialog = await chatDialog.boundingBox();
        const content = await page.locator('main').boundingBox();
        if (!dialog || !content) throw new Error('Chat dialog or app content pane has no bounding box');
        const signature = `${dialog.x}:${dialog.width}:${content.x}:${content.width}`;
        if (signature === previous) return { dialog, content };
        previous = signature;
        await page.waitForTimeout(100);
      }
      throw new Error('Chat dialog and app content pane geometry never settled');
    };

    await select('Panneau');
    await select('Gauche');
    const { dialog: left, content: leftContent } = await settledBoxes();
    expect(left.x).toBe(0);
    expect(left.x + left.width).toBeLessThanOrEqual(leftContent.x);

    await select('Droite');
    const { dialog: right, content: rightContent } = await settledBoxes();
    expect(right.x).toBeGreaterThan(0);
    expect(right.x + right.width).toBe(viewport.width);
    expect(rightContent.x + rightContent.width).toBeLessThanOrEqual(right.x);
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

  test('cancels a drag with Escape without closing the chat', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await chatButton.click();
    const chatDialog = page.locator('#chat-widget-dialog');
    const moveTrigger = chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' });
    const triggerBox = await moveTrigger.boundingBox();
    if (!triggerBox) throw new Error('Move trigger has no bounding box for Escape cancellation');

    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(80, 200);
    await expect(page.locator('[data-chat-placement-drop-zones]')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator('[data-chat-placement-drop-zones]')).toHaveCount(0);
    await expect(chatDialog).toBeVisible();
  });

  test('keeps Close clickable while the drop-zone overlay is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await chatButton.click();
    const chatDialog = page.locator('#chat-widget-dialog');
    const moveTrigger = chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' });
    const triggerBox = await moveTrigger.boundingBox();
    if (!triggerBox) throw new Error('Move trigger has no bounding box for the Close overlap check');

    const closeButton = chatDialog.getByRole('button', { name: 'Fermer' });
    const closeBox = await closeButton.boundingBox();
    if (!closeBox) throw new Error('Close button has no bounding box for the overlap check');

    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(80, 200);
    await expect(page.locator('[data-chat-placement-drop-zones]')).toBeVisible();

    // A real user cannot click while the primary button is already held, so
    // clicking here would not exercise anything meaningful. The invariant that
    // actually matters — and that a covering overlay broke once before — is
    // that the drop-zone layer never becomes the hit target over the Close
    // button. Assert the topmost element at Close's centre is still Close.
    const closeIsTopmost = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el?.closest('button[aria-label="Fermer"], button[title="Fermer"]'));
    }, { x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 });
    expect(closeIsTopmost).toBe(true);

    // Then finish the gesture like a user would, and confirm Close still works
    // and tears the overlay down.
    await page.mouse.up();
    await expect(page.locator('[data-chat-placement-drop-zones]')).toHaveCount(0);
    await closeButton.click();
    await expect(chatDialog).toBeHidden();
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

  test('renders exactly one header placement-mode control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await chatButton.click();
    const chatDialog = page.locator('#chat-widget-dialog');
    const headerModeControls = chatDialog.locator(
      'button[aria-label="Déplacer le chat vers…"], button[aria-label="Basculer en widget"], button[aria-label="Basculer en panneau"]',
    );
    await expect(headerModeControls).toHaveCount(1);
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

    await chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' }).click();
    await page.getByRole('menu', { name: 'Déplacer le chat vers…' })
      .getByRole('menuitemradio', { name: 'Centre', exact: true }).click();
    const floatingCenterBox = await chatDialog.boundingBox();
    if (!floatingCenterBox) throw new Error('Chat dialog has no bounding box after selecting Libre + Centre');
    expect(Math.abs(floatingCenterBox.x + floatingCenterBox.width / 2 - 720)).toBeLessThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('chatWidgetDisplayMode')))
      .toBe('floating');
  });
});

test.describe('Chat placement menu — header drag grammar', () => {
  const openChat = async (page: import('@playwright/test').Page) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click();
    const chatDialog = page.locator('#chat-widget-dialog');
    await expect(chatDialog).toBeVisible({ timeout: 10_000 });
    return chatDialog;
  };

  /** Drag the header grip to an absolute viewport point and release. */
  const dragHeaderTo = async (
    page: import('@playwright/test').Page,
    chatDialog: import('@playwright/test').Locator,
    x: number,
    y: number,
  ) => {
    const grip = chatDialog.locator('[data-chat-header-grip="true"]');
    const box = await grip.boundingBox();
    if (!box) throw new Error('Header grip has no bounding box');
    // The grip deliberately ignores presses that land on the header's own
    // controls, and the bar is narrow once docked — so scan its midline for a
    // point that is genuinely empty instead of assuming the centre is.
    const midY = box.y + box.height / 2;
    const grabX = await page.evaluate(
      ({ left, right, y }) => {
        for (let x = left + 4; x < right - 4; x += 6) {
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest('button, a, input, select, textarea, [role="menu"]')) return x;
        }
        return null;
      },
      { left: box.x, right: box.x + box.width, y: midY },
    );
    if (grabX === null) throw new Error('No draggable empty spot found on the header bar');
    await page.mouse.move(grabX, midY);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await expect(page.locator('[data-chat-placement-drop-zones]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-chat-placement-drop-zones]')).toHaveCount(0);
    // The commit is async and the container animates; let the geometry settle
    // before the caller measures it or starts another gesture, otherwise the
    // next press lands while the dialog is still being re-rendered.
    let previous = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const box = await chatDialog.boundingBox();
      const signature = box ? `${box.x}:${box.y}:${box.width}:${box.height}` : 'none';
      if (signature === previous) return;
      previous = signature;
      await page.waitForTimeout(100);
    }
  };

  test('docks to a panel when the header is dragged to a side edge', async ({ page }) => {
    const chatDialog = await openChat(page);
    await dragHeaderTo(page, chatDialog, 40, 400); // left edge band
    const box = await chatDialog.boundingBox();
    if (!box) throw new Error('Chat dialog has no bounding box after docking left');
    expect(box.x).toBe(0);
    expect(box.height).toBeGreaterThan(700); // a full-height panel, not a floating card
  });

  test('maximises when the header is dragged to the top middle', async ({ page }) => {
    const chatDialog = await openChat(page);
    await dragHeaderTo(page, chatDialog, 720, 40);
    const box = await chatDialog.boundingBox();
    if (!box) throw new Error('Chat dialog has no bounding box after maximising');
    expect(box.width).toBeGreaterThan(1300);
    expect(box.height).toBeGreaterThan(800);
  });

  test('detaches a docked panel dragged straight down out of its band', async ({ page }) => {
    const chatDialog = await openChat(page);
    // Dock through the MENU rather than a first drag: this test is about the
    // detach GESTURE, and chaining two drags back to back is a separate,
    // currently unreliable path (see BRANCH.md — the grip disarms between the
    // press and the threshold when a drag immediately follows another).
    // Docking by drag is covered on its own above.
    await chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' }).click();
    await page.getByRole('menu', { name: 'Déplacer le chat vers…' })
      .getByRole('menuitemradio', { name: 'Panneau', exact: true }).click();
    await page.waitForTimeout(400);
    const docked = await chatDialog.boundingBox();
    if (!docked) throw new Error('Chat dialog has no bounding box once docked');
    expect(docked.height).toBeGreaterThan(700);

    await dragHeaderTo(page, chatDialog, 1400, 820); // same edge, below the band
    const floating = await chatDialog.boundingBox();
    if (!floating) throw new Error('Chat dialog has no bounding box after detaching');
    // A floating card, no longer a full-height panel.
    expect(floating.height).toBeLessThan(docked.height);
  });

  test('a plain click on a header button is not swallowed by the grip', async ({ page }) => {
    const chatDialog = await openChat(page);
    await chatDialog.getByRole('button', { name: 'Déplacer le chat vers…' }).click();
    await expect(page.getByRole('menu', { name: 'Déplacer le chat vers…' })).toBeVisible();
  });
});
