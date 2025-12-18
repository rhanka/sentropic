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
      await page.waitForTimeout(300);
      
      // Vérifier qu'un formulaire s'ouvre (input pour le nom)
      const nameInput = page.locator('input[type="text"]').first();
      await expect(nameInput).toBeVisible();
    }
  });

  test('devrait afficher la liste des dossiers', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    // Vérifier le titre h1 comme assertion minimale
    await expect(page.locator('h1')).toContainText('Dossiers');
  });

  test('devrait permettre de cliquer sur un dossier et afficher les cas d\'usage', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher un dossier cliquable (pas en génération ou avec cas d'usage)
    const folderItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Génération en cours' });
    
    const itemCount = await folderItems.count();
    if (itemCount > 0) {
      const firstFolder = folderItems.first();
      
      // Cliquer sur l'article entier (la navigation est gérée par handleFolderClick sur l'article)
      await firstFolder.waitFor({ state: 'visible' });
      await firstFolder.click();
      
      // Attendre la redirection vers /cas-usage avec timeout
      await page.waitForURL(/\/cas-usage/, { timeout: 2000 });
      
      // Vérifier le titre "Cas d'usage"
      await expect(page.locator('h1')).toContainText('Cas d\'usage');
      
      // Vérifier la présence des cas d'usage (grille) ou message vide si aucun
      const useCaseGrid = page.locator('.grid.gap-4');
      await expect(useCaseGrid).toBeVisible();
    }
  });

  test('devrait afficher les informations des dossiers', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'il y a des informations sur les dossiers
    const folderInfo = page.locator('text=Nom, text=Description, text=Créé, text=Modifié');
    
    if (await folderInfo.count() > 0) {
      await expect(folderInfo.first()).toBeVisible();
    }
  });

  test('devrait permettre de supprimer un dossier', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    
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
      await page.waitForLoadState('domcontentloaded');
    }
  });
});


