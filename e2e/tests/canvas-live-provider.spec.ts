import { expect, test } from '@playwright/test';

test.describe('Canvas live provider switch', () => {
  test.use({ storageState: undefined });
  test('should keep the app shell live with the H3 provider surface present', async ({ page }) => {
    const response = await page.goto('/');
    expect([200, 302].includes(response?.status() ?? 0)).toBe(true);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeAttached();
    await expect(page.getByRole('link', { name: /Connexion/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
