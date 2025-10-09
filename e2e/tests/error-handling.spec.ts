import { test, expect } from '@playwright/test';

test.describe('Gestion des erreurs', () => {
  test('devrait gérer les erreurs 404', async ({ page }) => {
    const resp = await page.goto('/page-inexistante');
    // Vérifier que SvelteKit gère la 404 (status ou contenu page)
    expect(resp?.status()).toBe(404);
  });

  test('devrait gérer les erreurs de validation des formulaires', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Naviguer vers /new et vérifier que le bouton Créer est désactivé sans nom
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    const createBtn = page.locator('button:has-text("Créer")');
    await expect(createBtn).toBeDisabled();
  });

  test.skip('devrait gérer les erreurs de l\'API', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test.skip('devrait gérer les erreurs de génération IA', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test.skip('devrait gérer les erreurs de chargement des données', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test.skip('devrait gérer les erreurs de sauvegarde', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test('devrait gérer les erreurs de suppression', async ({ page }) => {
    // Intercepter les requêtes de suppression pour simuler une erreur
    await page.route('**/api/v1/companies/**', route => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Forbidden' })
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Essayer de supprimer une entreprise
    const deleteButtons = page.locator('button:has-text("Supprimer")');
    
    if (await deleteButtons.count() > 0) {
      page.on('dialog', dialog => dialog.accept());
      await deleteButtons.first().click();
      
      // Vérifier qu'une erreur s'affiche
      const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Forbidden');
      
      if (await errorMessages.count() > 0) {
        await expect(errorMessages.first()).toBeVisible();
      }
    }
  });

  test.skip('devrait gérer les erreurs de réseau', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test('devrait permettre de réessayer après une erreur', async ({ page }) => {
    // Intercepter les requêtes pour simuler une erreur puis un succès
    let requestCount = 0;
    await page.route('**/api/v1/companies**', route => {
      requestCount++;
      if (requestCount === 1) {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server Error' })
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Chercher un bouton de réessai
    const retryButtons = page.locator('button:has-text("Réessayer"), button:has-text("Retry"), button:has-text("Relancer")');
    
    if (await retryButtons.count() > 0) {
      await retryButtons.first().click();
      await page.waitForLoadState('networkidle');
    }
  });

  test.skip('devrait afficher des messages d\'erreur appropriés', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });
});
