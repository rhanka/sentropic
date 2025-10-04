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
    
    // Cliquer sur le bouton de suppression
    await page.click('button:has-text("Supprimer")');
    
    // Confirmer la suppression
    await page.on('dialog', dialog => dialog.accept());
    
    // Vérifier que l'entreprise a disparu
    await expect(page.locator('text=Company to Delete')).not.toBeVisible();
  });
});


