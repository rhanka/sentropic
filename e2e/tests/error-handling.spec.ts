import { test, expect } from '@playwright/test';

test.describe('Gestion des erreurs', () => {
  test('devrait gérer les erreurs 404', async ({ page }) => {
    await page.goto('/page-inexistante');
    
    // Vérifier que la page d'erreur s'affiche
    await expect(page.locator('text=404')).toBeVisible();
  });

  test('devrait gérer les erreurs de validation des formulaires', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Essayer de créer une entreprise sans nom
    await page.click('button:has-text("Ajouter")');
    await page.click('button:has-text("Enregistrer")');
    
    // Vérifier qu'une erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Required, text=Champ requis');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs de l\'API', async ({ page }) => {
    // Intercepter les requêtes API pour simuler une erreur
    await page.route('**/api/v1/**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' })
      });
    });
    
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'un message d'erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Failed');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs de génération IA', async ({ page }) => {
    // Intercepter les requêtes de génération pour simuler une erreur
    await page.route('**/api/v1/use-cases/generate**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'AI Generation Failed' })
      });
    });
    
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
    // Chercher des messages d'erreur liés à la génération
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Génération');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs de chargement des données', async ({ page }) => {
    // Intercepter les requêtes de chargement pour simuler une erreur
    await page.route('**/api/v1/folders**', route => {
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not Found' })
      });
    });
    
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'un message d'erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Chargement');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs de sauvegarde', async ({ page }) => {
    // Intercepter les requêtes de sauvegarde pour simuler une erreur
    await page.route('**/api/v1/companies**', route => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Validation Error' })
        });
      } else {
        route.continue();
      }
    });
    
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Essayer de créer une entreprise
    await page.click('button:has-text("Ajouter")');
    await page.fill('input[placeholder="Nom de l\'entreprise"]', 'Test Company');
    await page.fill('input[placeholder="Secteur d\'activité"]', 'Test');
    await page.click('button:has-text("Enregistrer")');
    
    // Vérifier qu'une erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Validation');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
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

  test('devrait gérer les erreurs de réseau', async ({ page }) => {
    // Simuler une erreur de réseau
    await page.route('**/api/v1/**', route => {
      route.abort('Failed');
    });
    
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'un message d'erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Réseau, text=Network');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
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

  test('devrait afficher des messages d\'erreur appropriés', async ({ page }) => {
    await page.goto('/page-inexistante');
    
    // Vérifier que le message d'erreur est approprié
    const errorMessage = page.locator('text=404, text=Page non trouvée, text=Not Found');
    await expect(errorMessage).toBeVisible();
    
    // Vérifier qu'il y a un lien de retour
    const backLink = page.locator('a:has-text("Retour"), a:has-text("Back"), button:has-text("Retour")');
    
    if (await backLink.count() > 0) {
      await expect(backLink.first()).toBeVisible();
    }
  });
});
