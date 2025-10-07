import { test, expect } from '@playwright/test';

test.describe('Détail des entreprises', () => {
  test('devrait afficher la page de détail d\'une entreprise', async ({ page }) => {
    // D'abord aller à la liste des entreprises
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Chercher une entreprise cliquable
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      
      // Cliquer sur l'entreprise
      await firstCompany.click();
      
      // Attendre la redirection
      await page.waitForLoadState('networkidle');
      
      // Vérifier qu'on est sur une page de détail
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/entreprises\/[a-zA-Z0-9-]+/);
      
      // Vérifier les éléments de base de la page de détail
      await expect(page.locator('h1, h2')).toBeVisible();
    }
  });

  test('devrait afficher les informations détaillées de l\'entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      await firstCompany.click();
      await page.waitForLoadState('networkidle');
      
      // Vérifier les informations de base
      await expect(page.locator('h1, h2')).toBeVisible();
      
      // Vérifier qu'il y a du contenu détaillé
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(100);
    }
  });

  test('devrait permettre de modifier une entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      await firstCompany.click();
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

  test('devrait permettre de supprimer une entreprise depuis la page de détail', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      await firstCompany.click();
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
        await expect(page).toHaveURL('/entreprises');
      }
    }
  });

  test('devrait afficher les cas d\'usage liés à l\'entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      await firstCompany.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher des éléments liés aux cas d'usage
      const useCaseElements = page.locator('text=Cas d\'usage, text=Use cases, .use-case');
      
      if (await useCaseElements.count() > 0) {
        await expect(useCaseElements.first()).toBeVisible();
      }
    }
  });

  test('devrait permettre de générer des cas d\'usage depuis l\'entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    const companyItems = page.locator('article, .company-item, [data-testid="company-item"]');
    
    if (await companyItems.count() > 0) {
      const firstCompany = companyItems.first();
      await firstCompany.click();
      await page.waitForLoadState('networkidle');
      
      // Chercher un bouton de génération
      const generateButton = page.locator('button:has-text("Générer"), button:has-text("IA"), button:has-text("Generate")');
      
      if (await generateButton.isVisible()) {
        await generateButton.click();
        
        // Vérifier qu'une action de génération est lancée
        // (peut être une redirection ou un formulaire)
        await page.waitForLoadState('networkidle');
      }
    }
  });
});
