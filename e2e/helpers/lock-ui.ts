import { expect, type Page } from '@playwright/test';

export async function waitForLockOwnedByMe(page: Page) {
  await expect
    .poll(async () => {
      const badge = page.locator('div[role="group"][aria-label="Verrou du document"]');
      const hasBadge = (await badge.count()) > 0;
      const headerLockButton = page.locator('button[aria-label="Verrou du document"]');
      const headerHidden = (await headerLockButton.count()) === 0;
      const tooltip = badge.locator('[role="tooltip"]');
      const tooltipText = (await tooltip.first().textContent()) || '';
      const tooltipOwned = tooltipText.includes('vous verrouillez le document');
      const requestButton = page.locator('button[aria-label="Demander le déverrouillage"]');
      const hasRequestButton = (await requestButton.count()) > 0;
      const editableField = page.locator('input:not([type="file"]):not(.hidden), textarea').first();
      const editableVisible = (await editableField.count()) > 0 && (await editableField.isVisible());
      const editableEnabled = editableVisible && (await editableField.isEnabled());
      return (
        tooltipOwned ||
        (hasBadge && headerHidden) ||
        (headerHidden && editableEnabled) ||
        (hasBadge && editableEnabled && !hasRequestButton)
      );
    }, { timeout: 15_000 })
    .toBe(true);
  const editableField = page.locator('input:not([type="file"]):not(.hidden), textarea').first();
  if ((await editableField.count()) > 0) {
    await expect(editableField).toBeVisible({ timeout: 10_000 });
    await expect(editableField).toBeEnabled({ timeout: 10_000 });
  }
}

export async function waitForLockedByOther(page: Page) {
  const badge = page.locator('div[role="group"][aria-label="Verrou du document"]');
  const requestButton = page.locator('button[aria-label="Demander le déverrouillage"]');
  const headerLockButton = page.locator('button[aria-label="Verrou du document"]');
  const editableField = page.locator('input:not([type="file"]):not(.hidden), textarea').first();
  await expect
    .poll(async () => {
      const hasBadge = (await badge.count()) > 0;
      const hasRequestButton = (await requestButton.count()) > 0;
      let tooltipOther = false;
      if (hasBadge) {
        await badge.scrollIntoViewIfNeeded();
        await badge.hover({ force: true });
        const tooltip = badge.locator('[role="tooltip"]');
        const text = (await tooltip.textContent()) || '';
        tooltipOther = text.includes('verrouille le document') && !text.includes('vous verrouillez');
      }
      const editableVisible = (await editableField.count()) > 0 && (await editableField.isVisible());
      const editableDisabled = editableVisible && (await editableField.isEnabled().then((v) => !v));
      const hasHeaderLock = (await headerLockButton.count()) > 0;
      return tooltipOther || hasRequestButton || (editableDisabled && (hasBadge || hasHeaderLock));
    }, { timeout: 15_000 })
    .toBe(true);
  if ((await requestButton.count()) > 0) {
    await expect(requestButton).toBeVisible({ timeout: 10_000 });
  }
  if ((await editableField.count()) > 0) {
    await expect(editableField).toBeVisible({ timeout: 10_000 });
    await expect(editableField).toBeDisabled({ timeout: 10_000 });
  }
}
