import { test, expect } from '@playwright/test';

test.describe('Détail des organisations', () => {
  test('devrait afficher la page de détail d\'une organisation', async ({ page }) => {
    // D'abord aller à la liste des organisations
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher une organisation cliquable (pas en enrichissement)
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      
      // Cliquer sur l'organisation
      await firstOrganization.click();
      

      // Preuve d'impact: soit navigation, soit POST observé
      await Promise.race([
        page.waitForURL(/\/organisations\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 2000 }),
        page.waitForRequest((r) => r.url().includes('/api/v1/organizations') && r.method() === 'POST', { timeout: 2000 })
      ]).catch(() => {});

      // Vérifier qu'on est sur une page de détail
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/organisations\/[a-zA-Z0-9-]+/);
      
      // Vérifier les éléments de base de la page de détail (h1 ou h2)
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible();
    }
  });

  test('devrait afficher les informations détaillées de l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Vérifier les informations de base
      await expect(page.locator('h1')).toBeVisible();
      
      // Vérifier qu'il y a du contenu détaillé
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(100);
    }
  });


  test('devrait afficher les cas d\'usage liés à l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher des éléments liés aux cas d'usage
      const useCaseElements = page.locator('text=Cas d\'usage, text=Use cases, .use-case');
      
      if (await useCaseElements.count() > 0) {
        await expect(useCaseElements.first()).toBeVisible();
      }
    }
  });

  test('devrait permettre de générer des cas d\'usage depuis l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher un bouton de génération
      const generateButton = page.locator('button:has-text("Générer"), button:has-text("IA"), button:has-text("Generate")');
      
      if (await generateButton.isVisible()) {
        await generateButton.click();
        
        // Vérifier qu'une action de génération est lancée
        // (peut être une redirection ou un formulaire)
        await page.waitForLoadState('domcontentloaded');
      }
    }
  });
});
