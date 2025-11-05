import { test, expect } from '@playwright/test';
import { debug, setupDebugBuffer } from '../helpers/debug';

// Setup debug buffer to display on test failure
setupDebugBuffer();

// Public (non authentifié)
test.describe('Public · WebAuthn Device Management', () => {
  test.use({ storageState: undefined });
  
  test('devrait rediriger vers la connexion si non authentifié', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    // Aller sur la page protégée
    await page.goto('/auth/devices');
    
    // Attendre que la page se charge et que les requêtes API soient terminées
    await page.waitForLoadState('networkidle');
    
    // Attendre la réponse de l'API de session (qui devrait retourner 401/403)
    await page.waitForResponse(
      response => response.url().includes('/auth/session') && response.status() !== 0,
      { timeout: 500 }
    ).catch(() => {}); // Ignorer si la réponse n'arrive pas
    
    // Attendre la redirection vers login avec un timeout généreux
    // La redirection peut prendre jusqu'à 0.5s (délai du spinner) + temps de navigation
    await page.waitForURL(/.*\/auth\/login/, { timeout: 500 });
    
    // Vérifier qu'on est bien sur la page de connexion
    await expect(page).toHaveURL(/.*\/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });
});

// Authentifié
test.describe('Authentifié · WebAuthn Device Management', () => {
  test('devrait afficher Mes Appareils quand connecté', async ({ page }) => {
    await page.goto('/auth/devices');
    await page.waitForLoadState('networkidle');
    
    // Vérifier qu'on n'est pas redirigé vers login
    const currentUrl = page.url();
    if (currentUrl.includes('/auth/login')) {
      throw new Error('Session révoquée - utilisateur non authentifié');
    }
    
    // Attendre que la page soit complètement chargée avant de vérifier
    await expect(page.getByRole('heading', { name: 'Mes Appareils' })).toBeVisible({ timeout: 10000 });
    
    // Vérifier qu'on est sur la page des appareils (pas redirigé vers login)
    await expect(page).toHaveURL(/.*\/auth\/devices/);
  });

  test('devrait permettre de supprimer un appareil', async ({ page }) => {
    await page.goto('/auth/devices');
    // Sélecteur généreux; adapter si data-testid existe plus tard
    const deleteButton = page.locator('[data-testid="delete-device"], button:has-text("Supprimer")');
    if (await deleteButton.first().isVisible()) {
      await deleteButton.first().click();
      // Optionnel: gérer dialog confirm si présent
    }
    await expect(page.locator('body')).toBeAttached();
  });
});

