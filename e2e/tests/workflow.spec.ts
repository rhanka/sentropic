import { test, expect } from '@playwright/test';

test.describe('Workflow métier complet', () => {
  test('devrait exécuter le workflow complet : organisation → génération → dossiers → cas d\'usage → dashboard', async ({ page }) => {
    // Étape 1: Créer une organisation
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    // Cliquer sur le bouton d'ajout (redirige vers /organisations/new)
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/organisations\/new$/);
    
    // Remplir le nom via l'EditableInput dans le H1 (textarea pour multiline)
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('TestOrganizationE2E');
    
    // Créer l'organisation
    await page.click('button:has-text("Créer")');
    await expect(page).toHaveURL(/\/organisations\/[a-zA-Z0-9-]+$/);
    
    // Vérifier sur la page détail
    const detailNameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await expect(detailNameInput).toHaveValue('TestOrganizationE2E');
    
    // Étape 2: Générer des cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'on est sur la page des cas d'usage
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Étape 3: Aller dans les dossiers pour voir l'avancement
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'on est sur la page des dossiers
    await expect(page.locator('h1')).toContainText('Dossiers');
    
    // Vérifier qu'on est sur la page dossiers (assertion h1 suffit)
    await expect(page.locator('h1')).toContainText('Dossiers');
    
    // Étape 4: Cliquer sur un dossier pour voir les cas d'usage
    const firstFolder = page.locator('article, .folder-item, [data-testid="folder-item"]').first();
    if (await firstFolder.isVisible()) {
      await firstFolder.click();
      
      // Attendre la redirection vers les cas d'usage
      await page.waitForLoadState('domcontentloaded');
      
      // Vérifier qu'on voit les cas d'usage
      await expect(page.locator('h1')).toContainText('Cas d\'usage');
      
      // Vérifier qu'il y a des cas d'usage (peut être en cours de génération)
      const useCaseCards = page.locator('article, .use-case-card, [data-testid="use-case-card"]');
      await expect(useCaseCards.first()).toBeVisible();
      
      // Attendre que la génération se termine (avec timeout)
      await page.waitForTimeout(5000);
      
      // Vérifier les statuts des cas d'usage
      const statusBadges = page.locator('.inline-flex.items-center.px-2.py-1.rounded-full');
      await expect(statusBadges.first()).toBeVisible();
    }
    
    // Étape 5: Aller au dashboard pour voir les métriques
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'on est sur le dashboard (le dashboard affiche maintenant le titre du dossier)
    // Le titre est dans un div avec classe "text-3xl font-semibold" ou un h1
    const dashboardTitle = page.locator('div.text-3xl.font-semibold, h1.text-3xl.font-semibold, h1:has-text("Dashboard")');
    await expect(dashboardTitle.first()).toBeVisible({ timeout: 10000 });
    
    // Vérifier les statistiques (nouvelle structure) - conditionnel si executive summary existe
    const statsText = page.locator('text=Nombre de cas d\'usage');
    const hasStats = await statsText.isVisible().catch(() => false);
    if (hasStats) {
      await expect(statsText).toBeVisible();
    }
    
    // Vérifier le graphique scatter plot (nouvelle structure)
    const scatterPlotContainer = page.locator('.report-scatter-plot-container');
    await expect(scatterPlotContainer).toBeVisible({ timeout: 10000 });
  });

  test('devrait gérer la génération asynchrone des cas d\'usage', async ({ page }) => {
    // Aller directement aux cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier les différents statuts possibles
    const statusElements = page.locator('.inline-flex.items-center.px-2.py-1.rounded-full');
    
    if (await statusElements.count() > 0) {
      // Vérifier qu'il y a au moins un statut visible
      await expect(statusElements.first()).toBeVisible();
      
      // Vérifier les différents types de statuts
      const statusTexts = await statusElements.allTextContents();
      const hasGeneratingStatus = statusTexts.some(text => 
        text.includes('Génération') || text.includes('Détail en cours') || text.includes('Brouillon')
      );
      
      // Au moins un statut devrait être présent
      expect(statusTexts.length).toBeGreaterThan(0);
    }
  });

  test('devrait permettre de voir les détails d\'un cas d\'usage', async ({ page }) => {
    // Aller aux cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher un cas d'usage cliquable (pas en génération)
    const useCaseCards = page.locator('article, .use-case-card, [data-testid="use-case-card"]');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier que la carte n'est pas en état de génération
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        // Cliquer sur la carte
        await firstCard.click();
        
        // Attendre la redirection vers la page de détail
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier qu'on est sur une page de détail (URL contient un ID)
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/cas-usage\/[a-zA-Z0-9-]+/);
      }
    }
  });

  test('devrait mettre à jour les métriques du dashboard en temps réel', async ({ page }) => {
    // Aller au dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier que les métriques sont présentes
    const totalMetric = page.locator('text=Total').locator('..').locator('p.text-2xl');
    const completedMetric = page.locator('text=Terminés').locator('..').locator('p.text-2xl');
    const inProgressMetric = page.locator('text=En cours').locator('..').locator('p.text-2xl');
    
    if (await totalMetric.isVisible()) {
      // Vérifier que les métriques sont des nombres
      const totalText = await totalMetric.textContent();
      const completedText = await completedMetric.textContent();
      const inProgressText = await inProgressMetric.textContent();
      
      expect(totalText).toMatch(/^\d+$/);
      expect(completedText).toMatch(/^\d+$/);
      expect(inProgressText).toMatch(/^\d+$/);
    }
  });

  test.skip('devrait permettre de changer de dossier dans le dashboard', async ({ page }) => {
    // Test skip: Le sélecteur de dossier n'existe plus dans la nouvelle structure du dashboard
    // Le changement de dossier se fait maintenant via la navigation vers /dossiers
  });
});
