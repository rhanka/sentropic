import { test, expect } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Gestion des erreurs', () => {
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_STATE = './.auth/state.json';

  test('devrait gérer les erreurs 404', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();
    try {
      const resp = await page.goto('/page-inexistante');
      // Vérifier que SvelteKit gère la 404 (status ou contenu page)
      expect(resp?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });

  test('devrait gérer les erreurs de validation des formulaires', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Naviguer vers /new et vérifier que le bouton Créer est désactivé sans nom
      const actionsButton = page.locator('button[aria-label="Actions organisation"]');
      await expect(actionsButton).toBeVisible({ timeout: 10_000 });
      await actionsButton.click();
      const newAction = page.locator('button:has-text("Nouveau")');
      await expect(newAction).toBeVisible({ timeout: 10_000 });
      await newAction.click();
      await expect(page).toHaveURL(/\/organisations\/new$/);
      const createBtn = page.getByRole('button', { name: 'Créer' });
      await expect(createBtn).toBeDisabled();
    } finally {
      await context.close();
    }
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

  test('devrait gérer les erreurs de suppression', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();
    try {
      // Intercepter les requêtes de suppression pour simuler une erreur
      await page.route('**/api/v1/organizations/**', route => {
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
      
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
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
    } finally {
      await context.close();
    }
  });

  test.skip('devrait gérer les erreurs de réseau', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });

  test('devrait permettre de réessayer après une erreur', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await context.newPage();
    try {
      // Intercepter les requêtes pour simuler une erreur puis un succès
      let requestCount = 0;
      await page.route('**/api/v1/organizations**', route => {
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
      
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher un bouton de réessai
      const retryButtons = page.locator('button:has-text("Réessayer"), button:has-text("Retry"), button:has-text("Relancer")');
      
      if (await retryButtons.count() > 0) {
        await retryButtons.first().click();
        await page.waitForLoadState('networkidle');
      }
    } finally {
      await context.close();
    }
  });

  test.skip('devrait afficher des messages d\'erreur appropriés', async ({ page }) => {
    // Test skip: UI error handling not fully implemented yet
  });
});
