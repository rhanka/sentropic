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
      return (hasBadge && headerHidden) || tooltipOwned;
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
  await expect(badge).toHaveCount(1);
  await badge.hover({ force: true });
  await expect
    .poll(async () => {
      const tooltip = badge.locator('[role="tooltip"]');
      const text = (await tooltip.textContent()) || '';
      return text.includes('verrouille le document') && !text.includes('vous verrouillez');
    }, { timeout: 10_000 })
    .toBe(true);
  const requestButton = page.locator('button[aria-label="Demander le déverrouillage"]');
  await expect(requestButton).toBeVisible({ timeout: 10_000 });
  const editableField = page.locator('input:not([type="file"]):not(.hidden), textarea').first();
  if ((await editableField.count()) > 0) {
    await expect(editableField).toBeVisible({ timeout: 10_000 });
    await expect(editableField).toBeDisabled({ timeout: 10_000 });
  }
}
