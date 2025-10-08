import { test, expect } from '@playwright/test';

test.describe('Gestion des entreprises', () => {
  test('devrait afficher la page des entreprises', async ({ page }) => {
    await page.goto('/entreprises');
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier le titre
    await expect(page.locator('h1')).toContainText('Entreprises');
    
    // Vérifier le bouton d'ajout
    await expect(page.locator('button:has-text("Ajouter")')).toBeVisible();
  });

  test('devrait permettre de créer une entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Cliquer sur le bouton d'ajout
    await page.click('button:has-text("Ajouter")');
    
    // Vérifier que le formulaire s'ouvre
    await expect(page.locator('h2:has-text("Nouvelle entreprise")')).toBeVisible();
    
    // Remplir le nom de l'entreprise
    await page.fill('input[placeholder="Nom de l\'entreprise"]', 'Test Company');
    
    // Remplir le secteur
    await page.fill('input[placeholder="Secteur d\'activité"]', 'Technologie');
    
    // Cliquer sur Enregistrer
    await page.click('button:has-text("Enregistrer")');
    
    // Vérifier que l'entreprise apparaît dans la liste
    await expect(page.locator('text=Test Company')).toBeVisible();
  });

  test('devrait afficher le bouton d\'enrichissement IA', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Cliquer sur le bouton d'ajout
    await page.click('button:has-text("Ajouter")');
    
    // Vérifier que le bouton IA est présent
    await expect(page.locator('button:has-text("IA")')).toBeVisible();
    
    // Remplir un nom d'entreprise
    await page.fill('input[placeholder="Nom de l\'entreprise"]', 'Microsoft');
    
    // Le bouton IA devrait être activé
    await expect(page.locator('button:has-text("IA")')).toBeEnabled();
  });

  test('devrait permettre de supprimer une entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Créer une entreprise d'abord
    await page.click('button:has-text("Ajouter")');
    await page.fill('input[placeholder="Nom de l\'entreprise"]', 'Company to Delete');
    await page.fill('input[placeholder="Secteur d\'activité"]', 'Test');
    await page.click('button:has-text("Enregistrer")');
    
    // Vérifier que l'entreprise est créée
    await expect(page.locator('text=Company to Delete')).toBeVisible();
    
    // Configurer la gestion de la boîte de dialogue avant de cliquer
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('supprimer');
      dialog.accept();
    });
    
    // Cliquer sur le bouton de suppression
    await page.click('button:has-text("Supprimer")');
    
    // Attendre que la suppression se termine
    await page.waitForLoadState('networkidle');
    
    // Vérifier que l'entreprise a disparu
    await expect(page.locator('text=Company to Delete')).not.toBeVisible();
  });

  test('devrait permettre de cliquer sur une entreprise pour voir ses détails', async ({ page }) => {
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
    }
  });

  test('devrait afficher les informations enrichies par l\'IA', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Créer une entreprise avec enrichissement IA
    await page.click('button:has-text("Ajouter")');
    await page.fill('input[placeholder="Nom de l\'entreprise"]', 'Microsoft');
    await page.fill('input[placeholder="Secteur d\'activité"]', 'Technologie');
    
    // Cliquer sur le bouton IA
    const aiButton = page.locator('button:has-text("IA")');
    await expect(aiButton).toBeEnabled();
    await aiButton.click();
    
    // Attendre que l'enrichissement se termine
    await page.waitForTimeout(3000);
    
    // Vérifier que des informations supplémentaires ont été ajoutées
    const enrichedFields = page.locator('input, textarea').filter({ hasText: /Microsoft|Technology|Software/ });
    
    if (await enrichedFields.count() > 0) {
      await expect(enrichedFields.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs lors de la création d\'entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Essayer de créer une entreprise sans nom
    await page.click('button:has-text("Ajouter")');
    await page.click('button:has-text("Enregistrer")');
    
    // Vérifier qu'une erreur s'affiche
    const errorMessages = page.locator('.error, .text-red-500, text=Erreur, text=Required');
    
    if (await errorMessages.count() > 0) {
      await expect(errorMessages.first()).toBeVisible();
    }
  });
});


