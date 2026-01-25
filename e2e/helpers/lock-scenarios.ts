import { expect, type Locator, type Page } from '@playwright/test';

type LockBreaksOnLeaveOptions = {
  pageA: Page;
  pageB: Page;
  url: string;
  getEditableField: (page: Page) => Locator;
  expectBadgeOnArrival?: boolean;
  expectBadgeGoneAfterLeave?: boolean;
  waitForSse?: boolean;
  waitForReady?: (page: Page) => Promise<void>;
};

export async function runLockBreaksOnLeaveScenario({
  pageA,
  pageB,
  url,
  getEditableField,
  expectBadgeOnArrival = false,
  expectBadgeGoneAfterLeave = false,
  waitForSse = true,
  waitForReady,
}: LockBreaksOnLeaveOptions) {
  await pageA.goto(url);
  await pageA.waitForLoadState('domcontentloaded');
  if (waitForSse) {
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 2000 }).catch(() => {});
  }
  if (waitForReady) {
    await waitForReady(pageA);
  }

  const editableA = getEditableField(pageA);
  await expect(editableA).toBeVisible({ timeout: 2_000 });
  await expect(editableA).toBeEnabled({ timeout: 2_000 });

  await pageB.goto(url);
  await pageB.waitForLoadState('domcontentloaded');
  if (waitForSse) {
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 2000 }).catch(() => {});
  }
  if (waitForReady) {
    await waitForReady(pageB);
  }

  const editableB = getEditableField(pageB);
  await expect(editableB).toBeVisible({ timeout: 2_000 });
  await expect(editableB).toBeDisabled({ timeout: 2_000 });

  const badgeB = pageB.locator('div[role="group"][aria-label="Verrou du document"]');
  const headerLockButtonB = pageB.locator('button[aria-label="Verrou du document"]');
  if (expectBadgeOnArrival) {
    await expect(badgeB).toHaveCount(1, { timeout: 2_000 });
  }

  await pageA.context().close();

  await expect(editableB).toBeEnabled({ timeout: 2_000 });
  if (expectBadgeGoneAfterLeave) {
    await expect(headerLockButtonB).toHaveCount(0, { timeout: 2_000 });
  }

  await editableB.click();
}
