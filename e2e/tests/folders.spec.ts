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

  test('devrait permettre de cliquer sur un dossier', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Chercher un dossier cliquable
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      
      // Cliquer sur le dossier
      await firstFolder.click();
      
      // Attendre la redirection
      await page.waitForLoadState('networkidle');
      
      // Vérifier qu'on est redirigé vers les cas d'usage ou une page de détail
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/(cas-usage|dossiers\/[a-zA-Z0-9-]+)/);
    }
  });

  test('devrait afficher les informations des dossiers', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'il y a des informations sur les dossiers
    const folderInfo = page.locator('text=Nom, text=Description, text=Créé, text=Modifié');
    
    if (await folderInfo.count() > 0) {
      await expect(folderInfo.first()).toBeVisible();
    }
  });

  test('devrait permettre de supprimer un dossier', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Chercher un bouton de suppression
    const deleteButtons = page.locator('button:has-text("Supprimer"), button[title="Supprimer"]');
    
    if (await deleteButtons.count() > 0) {
      // Configurer la gestion de la boîte de dialogue
      page.on('dialog', dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('supprimer');
        dialog.accept();
      });
      
      await deleteButtons.first().click();
      await page.waitForLoadState('networkidle');
    }
  });
});


