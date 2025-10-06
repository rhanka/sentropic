import { test, expect } from '@playwright/test';

test.describe('Gestion des dossiers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dossiers');
  });

  test('devrait afficher la page des dossiers', async ({ page }) => {
    await expect(page).toHaveURL('/dossiers');
    await expect(page.locator('h1')).toContainText('Dossiers');
  });

  test('devrait permettre de créer un nouveau dossier', async ({ page }) => {
    // Chercher le bouton de création
    const createButton = page.locator('button:has-text("Nouveau dossier")');
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // Vérifier qu'un formulaire s'ouvre
      await expect(page.locator('input[placeholder*="nom"]')).toBeVisible();
    }
  });

  test('devrait afficher la liste des dossiers', async ({ page }) => {
    // Attendre que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'il y a une zone pour les dossiers
    const foldersContainer = page.locator('[data-testid="folders-list"], .grid, .list');
    await expect(foldersContainer).toBeVisible();
  });
});


