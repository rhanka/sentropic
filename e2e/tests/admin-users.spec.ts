import { test, expect } from '@playwright/test';

const VICTIM_EMAIL = 'e2e-user-victim@example.com';

// Admin-only: uses default storageState (admin) from global.setup.ts
test.describe('Admin · Utilisateurs (Paramètres)', () => {
  test('le panneau admin est visible et le filtre par défaut est "Tous"', async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1')).toContainText('Paramètres', { timeout: 15_000 });
    await expect(page.locator('h2', { hasText: 'Admin · Utilisateurs' })).toBeVisible({ timeout: 15_000 });

    // Filtre par défaut = Tous (value="")
    const statusSelect = page.locator('label:has-text("Statut:") select');
    await expect(statusSelect).toBeVisible({ timeout: 15_000 });
    await expect(statusSelect).toHaveValue('');

    // Au moins un user seedé
    await expect(page.locator('body')).toContainText('e2e-user-a@example.com', { timeout: 15_000 });
  });

  test('sécurité: l’admin ne peut pas se désactiver / supprimer (UI)', async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');

    const adminRow = page.locator('tr').filter({ hasText: 'e2e-admin@example.com' }).first();
    await expect(adminRow).toBeVisible({ timeout: 15_000 });
    await expect(adminRow.locator('button', { hasText: 'Disable' })).toHaveCount(0);
    await expect(adminRow.locator('button', { hasText: 'Delete' })).toHaveCount(0);
  });

  test('l’admin peut disable/reactivate/delete un utilisateur non-admin (flux UI)', async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');

    // Panneau admin présent
    await expect(page.locator('h2', { hasText: 'Admin · Utilisateurs' })).toBeVisible();

    // Filtre par défaut = Tous (value="")
    const statusSelect = page.locator('label:has-text("Statut:") select');
    await expect(statusSelect).toBeVisible();
    await expect(statusSelect).toHaveValue('');

    // Sécurité: l’admin ne doit pas pouvoir se désactiver (pas de bouton "Disable" sur sa propre ligne)
    const adminRow = page.locator('tr').filter({ hasText: 'e2e-admin@example.com' }).first();
    if (await adminRow.count()) {
      await expect(adminRow.locator('button', { hasText: 'Disable' })).toHaveCount(0);
      await expect(adminRow.locator('button', { hasText: 'Delete' })).toHaveCount(0);
    }

    // Trouver la ligne de la "victim" (créée dans globalSetup)
    const victimRow = () => page.locator('tr').filter({ hasText: VICTIM_EMAIL }).first();
    await expect(victimRow()).toBeVisible({ timeout: 15_000 });

    // Disable
    page.on('dialog', (dialog) => dialog.accept());
    await victimRow().locator('button', { hasText: 'Disable' }).click();
    await expect(victimRow()).toContainText('disabled_by_admin', { timeout: 15_000 });

    // Reactivate
    await victimRow().locator('button', { hasText: 'Reactivate' }).click();
    await expect(victimRow()).toContainText('active', { timeout: 15_000 });

    // Disable then Delete (définitif)
    await victimRow().locator('button', { hasText: 'Disable' }).click();
    await expect(victimRow()).toContainText('disabled_by_admin', { timeout: 15_000 });

    await victimRow().locator('button', { hasText: 'Delete' }).click();
    await expect(page.locator('tr').filter({ hasText: VICTIM_EMAIL })).toHaveCount(0, { timeout: 15_000 });
  });
});


