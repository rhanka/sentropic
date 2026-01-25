import { expect, type Locator, type Page } from '@playwright/test';

function getDefaultEditableLocator(page: Page) {
  return page.locator('input:not([type="file"]):not(.hidden), textarea').first();
}

export async function waitForLockedByOther(page: Page, editableLocator?: Locator) {
  const badge = page.locator('div[role="group"][aria-label="Verrou du document"]');
  const requestButton = page.locator('button[aria-label="Demander le déverrouillage"]');
  const headerLockButton = page.locator('button[aria-label="Verrou du document"]');
  const editableField = editableLocator ?? getDefaultEditableLocator(page);
  await expect
    .poll(async () => {
      const hasBadge = (await badge.count()) > 0;
      const hasRequestButton = (await requestButton.count()) > 0;
      let tooltipOther = false;
      if (hasBadge) {
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          await badge.scrollIntoViewIfNeeded();
          await badge.hover({ force: true });
          const tooltip = badge.locator('[role="tooltip"]');
          const text = (await tooltip.textContent()) || '';
          tooltipOther = text.includes('verrouille le document') && !text.includes('vous verrouillez');
        } catch {
          tooltipOther = false;
        }
      }
      const editableVisible = (await editableField.count()) > 0 && (await editableField.isVisible());
      const editableDisabled = editableVisible && (await editableField.isEnabled().then((v) => !v));
      const hasHeaderLock = (await headerLockButton.count()) > 0;
      return tooltipOther || hasRequestButton || (editableDisabled && (hasBadge || hasHeaderLock));
    }, { timeout: 2_000 })
    .toBe(true);
  if ((await requestButton.count()) > 0) {
    await expect(requestButton).toBeVisible({ timeout: 2_000 });
  }
  if ((await editableField.count()) > 0) {
    await expect(editableField).toBeVisible({ timeout: 2_000 });
    await expect(editableField).toBeDisabled({ timeout: 2_000 });
  }
}

export async function waitForNoLocker(page: Page, editableLocator?: Locator) {
  const headerLockButton = page.locator('button[aria-label="Verrou du document"]');
  const editableField = editableLocator ?? getDefaultEditableLocator(page);
  await expect
    .poll(async () => {
      const hasHeaderLock = (await headerLockButton.count()) > 0;
      const editableVisible = (await editableField.count()) > 0 && (await editableField.isVisible());
      const editableEnabled = editableVisible && (await editableField.isEnabled());
      return !hasHeaderLock && editableEnabled;
    }, { timeout: 2_000 })
    .toBe(true);
  if ((await editableField.count()) > 0) {
    await expect(editableField).toBeVisible({ timeout: 2_000 });
    await expect(editableField).toBeEnabled({ timeout: 2_000 });
  }
}
