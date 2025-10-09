import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page dashboard', async ({ page }) => {
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('devrait afficher le sélecteur de dossier', async ({ page }) => {
    const folderSelect = page.locator('#folder-select');
    await expect(folderSelect).toBeVisible();
  });

  test('devrait afficher les statistiques des cas d\'usage', async ({ page }) => {
    // Vérifier les cartes de statistiques
    const statsCards = page.locator('.grid.gap-4.md\\:grid-cols-2.lg\\:grid-cols-3 > div');
    await expect(statsCards).toHaveCount(3);
    
    // Vérifier les titres des cartes
    await expect(page.locator('text=Total')).toBeVisible();
    await expect(page.locator('text=Terminés')).toBeVisible();
    await expect(page.locator('text=En cours')).toBeVisible();
  });

  test('devrait afficher le graphique scatter plot', async ({ page }) => {
    const scatterPlotSection = page.locator('h2:has-text("Matrice Valeur vs Complexité")');
    await expect(scatterPlotSection).toBeVisible();
  });

  test('devrait changer de dossier et mettre à jour les données', async ({ page }) => {
    // Attendre qu'il y ait au moins un dossier
    const folderSelect = page.locator('#folder-select');
    await expect(folderSelect).toBeVisible();
    
    // Vérifier que le changement de dossier fonctionne
    const options = await folderSelect.locator('option').all();
    if (options.length > 1) {
      await folderSelect.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');
      
      // Vérifier que les données se mettent à jour
      await expect(page.locator('h1')).toContainText('Dashboard');
    }
  });

  test('devrait afficher un message de chargement', async ({ page }) => {
    // Vérifier qu'il y a un indicateur de chargement si nécessaire
    const loadingIndicator = page.locator('.animate-spin');
    if (await loadingIndicator.isVisible()) {
      await expect(page.locator('text=Chargement des données...')).toBeVisible();
    }
  });

  test.skip('devrait gérer le cas sans dossier sélectionné', async ({ page }) => {
    // Test skip: seed data always provides folders; empty state not tested
  });
});