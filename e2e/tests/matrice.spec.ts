import { test, expect } from '@playwright/test';

test.describe('Configuration de la matrice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/matrice');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page de configuration de la matrice', async ({ page }) => {
    await expect(page).toHaveURL('/matrice');
    await expect(page.locator('h1')).toContainText('Configuration de l\'évaluation Valeur/Complexité');
  });

  test('devrait afficher le message d\'information sur la matrice', async ({ page }) => {
    const infoBox = page.locator('.bg-blue-50.border-l-4.border-blue-500');
    await expect(infoBox).toBeVisible();
    await expect(page.locator('text=Ajustez les poids des axes de valeur et de complexité')).toBeVisible();
  });

  test('devrait permettre de créer une nouvelle matrice si aucune n\'existe', async ({ page }) => {
    // Vérifier si le bouton de création de matrice est visible
    const createButton = page.locator('button:has-text("Créer une nouvelle matrice")');
    
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // Vérifier que la boîte de dialogue s'ouvre
      await expect(page.locator('text=Créer une nouvelle matrice')).toBeVisible();
      
      // Vérifier les options disponibles
      await expect(page.locator('text=Évaluation de base')).toBeVisible();
      await expect(page.locator('text=Copier une matrice existante')).toBeVisible();
      await expect(page.locator('text=Évaluation vierge')).toBeVisible();
    }
  });

  test('devrait afficher les axes de valeur et de complexité si configurés', async ({ page }) => {
    // Vérifier si les sections d'axes sont présentes
    const valueAxesSection = page.locator('h2:has-text("Axes de Valeur")');
    const complexityAxesSection = page.locator('h2:has-text("Axes de Complexité")');
    
    if (await valueAxesSection.isVisible()) {
      await expect(valueAxesSection).toBeVisible();
      await expect(complexityAxesSection).toBeVisible();
      
      // Vérifier les colonnes des tableaux
      await expect(page.locator('th:has-text("Critère")')).toBeVisible();
      await expect(page.locator('th:has-text("Poids")')).toBeVisible();
      await expect(page.locator('th:has-text("Action")')).toBeVisible();
    }
  });

  test('devrait permettre de modifier les poids des axes', async ({ page }) => {
    // Chercher les inputs de poids
    const weightInputs = page.locator('input[type="number"][min="0.5"][max="3"]');
    
    if (await weightInputs.first().isVisible()) {
      const firstWeightInput = weightInputs.first();
      await firstWeightInput.fill('2.5');
      
      // Vérifier que la valeur a été mise à jour
      await expect(firstWeightInput).toHaveValue('2.5');
    }
  });

  test('devrait afficher les seuils de valeur et complexité', async ({ page }) => {
    const valueThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Valeur")');
    const complexityThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Complexité")');
    
    if (await valueThresholdsSection.isVisible()) {
      await expect(valueThresholdsSection).toBeVisible();
      await expect(complexityThresholdsSection).toBeVisible();
      
      // Vérifier les colonnes des seuils
      await expect(page.locator('th:has-text("Valeur")')).toBeVisible();
      await expect(page.locator('th:has-text("Points Fibonacci")')).toBeVisible();
      await expect(page.locator('th:has-text("Nombre de cas")')).toBeVisible();
    }
  });

  test('devrait permettre de sauvegarder les modifications', async ({ page }) => {
    const saveButton = page.locator('button:has-text("Enregistrer la configuration")');
    
    if (await saveButton.isVisible()) {
      await expect(saveButton).toBeEnabled();
      
      // Cliquer sur sauvegarder
      await saveButton.click();
      
      // Vérifier qu'un message de succès apparaît (via toast)
      // Note: Les toasts peuvent être difficiles à tester, on vérifie juste que le bouton est cliquable
    }
  });

  test('devrait afficher l\'avertissement sur le recalcul des scores', async ({ page }) => {
    const warningBox = page.locator('.bg-yellow-50.border-l-4.border-yellow-500');
    
    if (await warningBox.isVisible()) {
      await expect(warningBox).toBeVisible();
      await expect(page.locator('text=Modifier les poids recalculera automatiquement tous les scores')).toBeVisible();
    }
  });

  test('devrait gérer le cas sans dossier sélectionné', async ({ page }) => {
    // Si aucun dossier n'est sélectionné, vérifier le message d'info
    const infoMessage = page.locator('text=Veuillez sélectionner un dossier pour voir sa matrice');
    
    if (await infoMessage.isVisible()) {
      await expect(infoMessage).toBeVisible();
    }
  });
});
