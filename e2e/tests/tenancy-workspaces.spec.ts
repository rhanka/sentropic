import { test, expect } from '@playwright/test';

test.describe('Tenancy / cloisonnement workspace', () => {
  test.describe('Workspace A', () => {
    test.use({ storageState: './.auth/user-a.json' });

    test('ne devrait pas voir les données du workspace B', async ({ page }) => {
      await page.goto('/entreprises');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Entreprises', { timeout: 15_000 });

      // Seeded company in workspace A
      await expect(page.locator('body')).toContainText('Pomerleau', { timeout: 15_000 });

      // Must not see workspace B company
      await expect(page.locator('body')).not.toContainText('Groupe BMR', { timeout: 15_000 });
    });
  });

  test.describe('Workspace B', () => {
    test.use({ storageState: './.auth/user-b.json' });

    test('ne devrait pas voir les données du workspace A', async ({ page }) => {
      await page.goto('/entreprises');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Entreprises', { timeout: 15_000 });

      // Seeded company in workspace B
      await expect(page.locator('body')).toContainText('Groupe BMR', { timeout: 15_000 });

      // Must not see workspace A company
      await expect(page.locator('body')).not.toContainText('Pomerleau', { timeout: 15_000 });
    });
  });
});
