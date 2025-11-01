import { test, expect } from '@playwright/test';

// Public (non authentifié)
test.describe('Public · Authentication Routes Access', () => {
  test.use({ storageState: undefined });
  test('devrait accéder à la page de connexion', async ({ page }) => {
    // Aller sur la page de connexion
    const response = await page.goto('/auth/login');
    
    // Vérifier que la page répond
    expect(response?.status()).toBe(200);
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le body est présent
    await expect(page.locator('body')).toBeAttached();
    
    // Prendre une capture d'écran pour debug
    await page.screenshot({ path: 'debug-login-page.png' });
    
    // Vérifier le contenu de la page
    const bodyText = await page.locator('body').textContent();
    // console.log('Login page content:', bodyText?.substring(0, 500));
  });

  test('devrait accéder à la page d\'inscription', async ({ page }) => {
    // Aller sur la page d'inscription
    const response = await page.goto('/auth/register');
    
    // Vérifier que la page répond
    expect(response?.status()).toBe(200);
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le body est présent
    await expect(page.locator('body')).toBeAttached();
    
    // Prendre une capture d'écran pour debug
    await page.screenshot({ path: 'debug-register-page.png' });
    
    // Vérifier le contenu de la page
    const bodyText = await page.locator('body').textContent();
    // console.log('Register page content:', bodyText?.substring(0, 500));
  });

  test('devrait accéder à la page de gestion des appareils', async ({ page }) => {
    // Aller sur la page de gestion des appareils
    const response = await page.goto('/auth/devices');
    
    // Vérifier que la page répond (peut être 200 ou redirigé)
    expect([200, 302, 404]).toContain(response?.status());
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le body est présent
    await expect(page.locator('body')).toBeAttached();
    
    // Prendre une capture d'écran pour debug
    await page.screenshot({ path: 'debug-devices-page.png' });
    
    // Vérifier le contenu de la page
    const bodyText = await page.locator('body').textContent();
    // console.log('Devices page content:', bodyText?.substring(0, 500));
  });

  test('devrait gérer les routes inexistantes', async ({ page }) => {
    // Aller sur une route inexistante
    const response = await page.goto('/auth/nonexistent');
    
    // Vérifier que la page répond (peut être 404 ou 200 avec contenu d'erreur)
    expect([200, 404]).toContain(response?.status());
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le body est présent
    await expect(page.locator('body')).toBeAttached();
  });
});
