import { test, expect } from '@playwright/test';

test.describe('Détail des dossiers', () => {
  test('devrait afficher la page de détail d\'un dossier', async ({ page }) => {
    // D'abord aller à la liste des dossiers
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    // Chercher un dossier cliquable
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      
      // Cliquer sur le dossier
      await firstFolder.click();
      
      // Attendre la redirection
      await page.waitForLoadState('networkidle');
      
      // Vérifier qu'on est sur une page de détail ou redirigé vers les cas d'usage
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/(dossiers\/[a-zA-Z0-9-]+|cas-usage)/);
      
      // Vérifier les éléments de base
      await expect(page.locator('h1, h2')).toBeVisible();
    }
  });

  test('devrait afficher les informations du dossier', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Vérifier les informations de base
      await expect(page.locator('h1, h2')).toBeVisible();
      
      // Vérifier qu'il y a du contenu
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(50);
    }
  });

  test('devrait afficher les cas d\'usage du dossier', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher des éléments liés aux cas d'usage
      const useCaseElements = page.locator('text=Cas d\'usage, .use-case, article.rounded.border');
      
      if (await useCaseElements.count() > 0) {
        await expect(useCaseElements.first()).toBeVisible();
      }
    }
  });

  test('devrait permettre de modifier un dossier', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher un bouton de modification
      const editButton = page.locator('button:has-text("Modifier"), button[title="Modifier"]');
      
      if (await editButton.isVisible()) {
        await editButton.click();
        
        // Vérifier qu'un formulaire d'édition s'ouvre
        await expect(page.locator('input, textarea')).toBeVisible();
      }
    }
  });

  test('devrait permettre de supprimer un dossier', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher un bouton de suppression
      const deleteButton = page.locator('button:has-text("Supprimer"), button[title="Supprimer"]');
      
      if (await deleteButton.isVisible()) {
        // Configurer la gestion de la boîte de dialogue
        page.on('dialog', dialog => {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toContain('supprimer');
          dialog.accept();
        });
        
        await deleteButton.click();
        
        // Vérifier qu'on est redirigé vers la liste
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL('/dossiers');
      }
    }
  });

  test('devrait afficher l\'avancement de la génération', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher des indicateurs d'avancement
      const progressElements = page.locator('text=Génération, text=En cours, .animate-spin, .progress');
      
      if (await progressElements.count() > 0) {
        await expect(progressElements.first()).toBeVisible();
      }
    }
  });

  test('devrait permettre de générer de nouveaux cas d\'usage', async ({ page }) => {
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    const folderItems = page.locator('article, .folder-item, [data-testid="folder-item"]');
    
    if (await folderItems.count() > 0) {
      const firstFolder = folderItems.first();
      await firstFolder.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher un bouton de génération
      const generateButton = page.locator('button:has-text("Générer"), button:has-text("Nouveau"), button:has-text("IA")');
      
      if (await generateButton.isVisible()) {
        await generateButton.click();
        
        // Vérifier qu'une action de génération est lancée
        await page.waitForLoadState('networkidle');
      }
    }
  });
});
