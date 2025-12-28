import { test, expect } from '@playwright/test';

test.describe('Tenancy / cloisonnement workspace', () => {
  test.describe('Workspace A', () => {
    test.use({ storageState: './.auth/user-a.json' });

    test('ne devrait pas voir les données du workspace B', async ({ page }) => {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });

      // Seeded organization in workspace A
      await expect(page.locator('body')).toContainText('Pomerleau', { timeout: 15_000 });

      // Must not see workspace B organization
      await expect(page.locator('body')).not.toContainText('Groupe BMR', { timeout: 15_000 });
    });
  });

  test.describe('Workspace B', () => {
    test.use({ storageState: './.auth/user-b.json' });

    test('ne devrait pas voir les données du workspace A', async ({ page }) => {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });

      // Seeded organization in workspace B
      await expect(page.locator('body')).toContainText('Groupe BMR', { timeout: 15_000 });

      // Must not see workspace A organization
      await expect(page.locator('body')).not.toContainText('Pomerleau', { timeout: 15_000 });
    });
  });
});
