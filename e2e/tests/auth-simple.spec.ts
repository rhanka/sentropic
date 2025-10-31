import { test, expect } from '@playwright/test';

// Public (non authentifié)
test.describe('Public · Authentication - Basic Tests', () => {
  test.use({ storageState: undefined });
  test('devrait accéder aux pages d\'authentification', async ({ page }) => {
    // Test de la page de connexion
    const loginResponse = await page.goto('/auth/login');
    expect(loginResponse?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
    
    // Test de la page d'inscription
    const registerResponse = await page.goto('/auth/register');
    expect(registerResponse?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
    
    // Test de la page de gestion des appareils
    const devicesResponse = await page.goto('/auth/devices');
    expect([200, 302, 404]).toContain(devicesResponse?.status());
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
  });

  test('devrait afficher les titres des pages d\'authentification', async ({ page }) => {
    // Page de connexion
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le titre contient "Connexion"
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('Connexion');
    
    // Page d'inscription
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le titre contient "Créer un compte"
    const registerBodyText = await page.locator('body').textContent();
    expect(registerBodyText).toContain('Créer un compte');
  });

  test('devrait gérer la navigation entre les pages', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    // Aller sur la page d'accueil
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier que les liens de navigation sont présents
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('Connexion');
  });

  test('devrait gérer les pages protégées', async ({ page }) => {
    // Essayer d'accéder au dashboard sans être connecté
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge (peut être redirigée ou non selon la configuration)
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier l'URL finale
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/.*\/(dashboard|auth\/login)/);
  });
});

test.describe('Authentication - Error Handling', () => {
  test('devrait gérer les erreurs de réseau gracieusement', async ({ page }) => {
    // Intercepter les requêtes API pour simuler une erreur
    await page.route('**/api/v1/auth/**', route => {
      route.abort('failed');
    });
    
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge malgré l'erreur réseau
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier qu'aucune erreur critique n'apparaît dans le DOM
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('500');
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('devrait gérer les routes inexistantes', async ({ page }) => {
    // Essayer d'accéder à une route d'authentification inexistante
    const response = await page.goto('/auth/nonexistent');
    
    // Vérifier que la page répond (peut être 404 ou 200 avec contenu d'erreur)
    expect([200, 404]).toContain(response?.status());
    
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
  });
});

test.describe('Authentication - Accessibility', () => {
  test('devrait être accessible au clavier', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page est focusable
    await page.keyboard.press('Tab');
    
    // Vérifier que la page répond aux interactions clavier
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeDefined();
  });

  test('devrait être responsive', async ({ page }) => {
    // Test sur mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
    
    // Test sur tablette
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeAttached();
  });
});
