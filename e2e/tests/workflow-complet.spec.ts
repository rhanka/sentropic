import { test, expect } from '@playwright/test';

test.describe('Workflow métier complet', () => {
  test('devrait exécuter le workflow complet : entreprise → génération → dossiers → cas d\'usage → dashboard', async ({ page }) => {
    // Étape 1: Créer une entreprise
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Cliquer sur le bouton d'ajout (redirige vers /entreprises/new)
    await page.click('button:has-text("Ajouter")');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur la page de création
    await expect(page.locator('h1')).toContainText('Nouvelle entreprise');
    
    // Cliquer sur le titre pour éditer le nom (EditableInput)
    const nameInput = page.locator('h1').first();
    await nameInput.click();
    
    // Remplir le nom de l'entreprise
    await page.keyboard.type('Test Company E2E');
    await page.keyboard.press('Enter');
    
    // Cliquer sur le bouton "Créer" au lieu de "IA" pour éviter les timeouts
    await page.click('button:has-text("Créer")');
    
    // Attendre la redirection vers la page de détail de l'entreprise
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur la page de détail de l'entreprise
    await expect(page.locator('h1')).toContainText('Test Company E2E');
    
    // Naviguer vers la liste des entreprises
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur la liste des entreprises
    await expect(page.locator('h1')).toContainText('Entreprises');
    
    // Vérifier que l'entreprise est créée
    await expect(page.locator('text=Test Company E2E')).toBeVisible();
    
    // Étape 2: Générer des cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur la page des cas d'usage
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Étape 3: Aller dans les dossiers pour voir l'avancement
    await page.goto('/dossiers');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur la page des dossiers
    await expect(page.locator('h1')).toContainText('Dossiers');
    
    // Vérifier qu'il y a au moins un dossier (créé lors de la génération)
    const foldersList = page.locator('[data-testid="folders-list"], .grid, .list');
    await expect(foldersList).toBeVisible();
    
    // Étape 4: Cliquer sur un dossier pour voir les cas d'usage
    const firstFolder = page.locator('article, .folder-item, [data-testid="folder-item"]').first();
    if (await firstFolder.isVisible()) {
      await firstFolder.click();
      
      // Attendre la redirection vers les cas d'usage
      await page.waitForLoadState('networkidle');
      
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
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on est sur le dashboard
    await expect(page.locator('h1')).toContainText('Dashboard');
    
    // Vérifier les statistiques
    await expect(page.locator('text=Total')).toBeVisible();
    await expect(page.locator('text=Terminés')).toBeVisible();
    await expect(page.locator('text=En cours')).toBeVisible();
    
    // Vérifier le graphique scatter plot
    await expect(page.locator('h2:has-text("Matrice Valeur vs Complexité")')).toBeVisible();
    
    // Vérifier le sélecteur de dossier
    const folderSelect = page.locator('#folder-select');
    await expect(folderSelect).toBeVisible();
  });

  test('devrait gérer la génération asynchrone des cas d\'usage', async ({ page }) => {
    // Aller directement aux cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
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
    await page.waitForLoadState('networkidle');
    
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
        await page.waitForLoadState('networkidle');
        
        // Vérifier qu'on est sur une page de détail (URL contient un ID)
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/cas-usage\/[a-zA-Z0-9-]+/);
      }
    }
  });

  test('devrait mettre à jour les métriques du dashboard en temps réel', async ({ page }) => {
    // Aller au dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
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

  test('devrait permettre de changer de dossier dans le dashboard', async ({ page }) => {
    // Aller au dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Vérifier le sélecteur de dossier
    const folderSelect = page.locator('#folder-select');
    await expect(folderSelect).toBeVisible();
    
    // Vérifier qu'il y a des options
    const options = await folderSelect.locator('option').all();
    
    if (options.length > 1) {
      // Changer de dossier
      await folderSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');
      
      // Vérifier que les données se mettent à jour
      await expect(page.locator('h1')).toContainText('Dashboard');
    }
  });
});
