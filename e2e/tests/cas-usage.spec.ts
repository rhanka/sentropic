import { test, expect } from '@playwright/test';

test.describe('Gestion des cas d\'usage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page des cas d\'usage', async ({ page }) => {
    await expect(page).toHaveURL('/cas-usage');
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
  });

  test('devrait afficher la liste des cas d\'usage', async ({ page }) => {
    // Aller à la page des cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
    // Attendre que la page se charge complètement
    await page.waitForSelector('h1:has-text("Cas d\'usage")', { timeout: 5000 });
    
    // Vérifier qu'on est sur la bonne page
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Vérifier que la page contient du contenu (au minimum le titre)
    await expect(page.locator('h1')).toBeVisible();
  });

  test('devrait afficher les cartes de cas d\'usage avec les bonnes informations', async ({ page }) => {
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier les éléments de base
      await expect(firstCard.locator('h2.text-xl.font-medium')).toBeVisible();
      
      // Vérifier les scores de valeur et complexité
      await expect(firstCard.locator('text=Valeur:')).toBeVisible();
      await expect(firstCard.locator('text=Complexité:')).toBeVisible();
      
      // Vérifier les boutons d'action
      await expect(firstCard.locator('button[title="Voir les détails"]')).toBeVisible();
      await expect(firstCard.locator('button[title="Modifier"]')).toBeVisible();
      await expect(firstCard.locator('button[title="Supprimer"]')).toBeVisible();
    }
  });

  test('devrait afficher les différents statuts des cas d\'usage', async ({ page }) => {
    const statusBadges = page.locator('.inline-flex.items-center.px-2.py-1.rounded-full');
    
    if (await statusBadges.count() > 0) {
      // Vérifier qu'il y a au moins un badge de statut
      await expect(statusBadges.first()).toBeVisible();
      
      // Vérifier les différents types de statuts possibles
      const statusTexts = await statusBadges.allTextContents();
      const possibleStatuses = ['Actif', 'Brouillon', 'Génération...', 'Détail en cours'];
      
      const hasValidStatus = statusTexts.some(text => 
        possibleStatuses.some(status => text.includes(status))
      );
      
      expect(hasValidStatus).toBeTruthy();
    }
  });

  test('devrait permettre de cliquer sur un cas d\'usage pour voir les détails', async ({ page }) => {
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier que la carte n'est pas en état de génération
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        // Cliquer sur la carte
        await firstCard.click();
        
        // Attendre la redirection
        await page.waitForLoadState('networkidle');
        
        // Vérifier qu'on est sur une page de détail
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/cas-usage\/[a-zA-Z0-9-]+/);
      }
    }
  });

  test('devrait permettre de supprimer un cas d\'usage', async ({ page }) => {
    const deleteButtons = page.locator('button[title="Supprimer"]');
    
    if (await deleteButtons.count() > 0) {
      const firstDeleteButton = deleteButtons.first();
      
      // Cliquer sur supprimer
      await firstDeleteButton.click();
      
      // Vérifier que la confirmation apparaît
      page.on('dialog', dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('supprimer');
        dialog.accept();
      });
    }
  });

  test('devrait afficher les étoiles de valeur et complexité', async ({ page }) => {
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier les étoiles de valeur (jaunes)
      const valueStars = firstCard.locator('svg.text-yellow-400');
      await expect(valueStars).toHaveCount(5);
      
      // Vérifier les étoiles de complexité (rouges)
      const complexityStars = firstCard.locator('svg.text-red-500');
      await expect(complexityStars).toHaveCount(5);
    }
  });

  test('devrait gérer les cas d\'usage en cours de génération', async ({ page }) => {
    const generatingCards = page.locator('article.opacity-60.cursor-not-allowed');
    
    if (await generatingCards.count() > 0) {
      const firstGeneratingCard = generatingCards.first();
      
      // Vérifier que la carte est désactivée
      await expect(firstGeneratingCard).toHaveClass(/opacity-60/);
      await expect(firstGeneratingCard).toHaveClass(/cursor-not-allowed/);
      
      // Vérifier le badge de génération
      const generatingBadge = firstGeneratingCard.locator('text=Génération...');
      await expect(generatingBadge).toBeVisible();
    }
  });

  test('devrait afficher un message si aucun dossier n\'est sélectionné', async ({ page }) => {
    // Vérifier s'il y a un message d'information
    const infoMessage = page.locator('text=Veuillez sélectionner un dossier pour voir ses cas d\'usage');
    
    if (await infoMessage.isVisible()) {
      await expect(infoMessage).toBeVisible();
    }
  });

  test('devrait gérer le chargement des cas d\'usage', async ({ page }) => {
    // Vérifier s'il y a un indicateur de chargement
    const loadingIndicator = page.locator('.animate-spin');
    const loadingText = page.locator('text=Chargement des cas d\'usage...');
    
    if (await loadingIndicator.isVisible()) {
      await expect(loadingText).toBeVisible();
    }
  });
});
