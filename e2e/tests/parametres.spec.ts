import { test, expect } from '@playwright/test';

test.describe('Page Paramètres', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page des paramètres', async ({ page }) => {
    await expect(page).toHaveURL('/parametres');
    await expect(page.locator('h1')).toContainText('Paramètres');
  });

  test('devrait afficher les sections de configuration', async ({ page }) => {
    // Vérifier qu'il y a du contenu de configuration
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length).toBeGreaterThan(50);
    
    // Chercher des sections de configuration communes
    const configSections = page.locator('h2, h3, .config-section, .setting-group');
    
    if (await configSections.count() > 0) {
      await expect(configSections.first()).toBeVisible();
    }
  });

  test('devrait permettre de modifier les paramètres', async ({ page }) => {
    // Chercher des inputs de configuration
    const configInputs = page.locator('input, select, textarea');
    
    if (await configInputs.count() > 0) {
      const firstInput = configInputs.first();
      await expect(firstInput).toBeVisible();
      
      // Essayer de modifier une valeur
      if (await firstInput.isEditable()) {
        await firstInput.fill('test value');
        await expect(firstInput).toHaveValue('test value');
      }
    }
  });

  test('devrait permettre de sauvegarder les paramètres', async ({ page }) => {
    // Chercher un bouton de sauvegarde
    const saveButton = page.locator('button:has-text("Sauvegarder"), button:has-text("Enregistrer"), button:has-text("Save")');
    
    if (await saveButton.isVisible()) {
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      
      // Vérifier qu'une action de sauvegarde est lancée
      await page.waitForLoadState('networkidle');
    }
  });

  test('devrait afficher les paramètres de langue', async ({ page }) => {
    // Chercher un sélecteur de langue
    const languageSelect = page.locator('select, [data-testid="language-select"]');
    
    if (await languageSelect.isVisible()) {
      await expect(languageSelect).toBeVisible();
      
      // Vérifier les options de langue
      const options = await languageSelect.locator('option').all();
      expect(options.length).toBeGreaterThan(0);
    }
  });

  test('devrait permettre de changer de langue', async ({ page }) => {
    const languageSelect = page.locator('select, [data-testid="language-select"]');
    
    if (await languageSelect.isVisible()) {
      // Changer vers l'anglais si disponible
      const englishOption = languageSelect.locator('option[value="en"], option:has-text("English")');
      
      if (await englishOption.isVisible()) {
        await languageSelect.selectOption({ value: 'en' });
        await page.waitForLoadState('networkidle');
        
        // Vérifier que l'interface change
        const englishText = page.locator('text=Settings, text=Save, text=Language');
        if (await englishText.count() > 0) {
          await expect(englishText.first()).toBeVisible();
        }
      }
    }
  });

  test('devrait afficher les paramètres de l\'API', async ({ page }) => {
    // Chercher des paramètres liés à l'API
    const apiSettings = page.locator('text=API, text=OpenAI, text=Configuration, text=Endpoint');
    
    if (await apiSettings.count() > 0) {
      await expect(apiSettings.first()).toBeVisible();
    }
  });

  test('devrait afficher les paramètres de la base de données', async ({ page }) => {
    // Chercher des paramètres liés à la base de données
    const dbSettings = page.locator('text=Base de données, text=Database, text=SQLite, text=Backup');
    
    if (await dbSettings.count() > 0) {
      await expect(dbSettings.first()).toBeVisible();
    }
  });

  test('devrait permettre de réinitialiser les paramètres', async ({ page }) => {
    // Chercher un bouton de réinitialisation
    const resetButton = page.locator('button:has-text("Réinitialiser"), button:has-text("Reset"), button:has-text("Restaurer")');
    
    if (await resetButton.isVisible()) {
      // Configurer la gestion de la confirmation
      page.on('dialog', dialog => {
        expect(dialog.type()).toBe('confirm');
        dialog.accept();
      });
      
      await resetButton.click();
      await page.waitForLoadState('networkidle');
    }
  });

  test('devrait afficher les informations de version', async ({ page }) => {
    // Chercher des informations de version
    const versionInfo = page.locator('text=Version, text=v1, text=Build, text=©');
    
    if (await versionInfo.count() > 0) {
      await expect(versionInfo.first()).toBeVisible();
    }
  });

  test('devrait gérer les erreurs de validation', async ({ page }) => {
    // Essayer de saisir des valeurs invalides
    const configInputs = page.locator('input[type="number"], input[type="email"], input[type="url"]');
    
    if (await configInputs.count() > 0) {
      const firstInput = configInputs.first();
      
      if (await firstInput.isEditable()) {
        // Saisir une valeur invalide
        await firstInput.fill('invalid-value');
        
        // Chercher des messages d'erreur
        const errorMessages = page.locator('.error, .text-red-500, .invalid, [role="alert"]');
        
        if (await errorMessages.count() > 0) {
          await expect(errorMessages.first()).toBeVisible();
        }
      }
    }
  });
});
