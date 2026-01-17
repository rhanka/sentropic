import { test, expect } from '@playwright/test';

const USER_A_STATE = './.auth/user-a.json';

test.describe('Access control — UI admin', () => {
  test.use({ storageState: USER_A_STATE });

  test('un non-admin ne voit pas le panneau admin dans Paramètres', async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');

    // Le panneau AdminUsersPanel est injecté seulement pour admin_app
    await expect(page.locator('h2', { hasText: 'Admin · Utilisateurs' })).toHaveCount(0);
    await expect(page.locator('text=Accès refusé (admin_app requis).')).toHaveCount(0);

    // Vérifier que la section workspace est visible pour un utilisateur non-admin
    await expect(page.locator('h2', { hasText: 'Compte & Workspace' })).toBeVisible();
    await expect(page.locator('text=Créer un workspace')).toBeVisible();
  });
});


