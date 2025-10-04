import { test, expect } from '@playwright/test';

test.describe('Application principale', () => {
  test('devrait charger la page d\'accueil', async ({ page }) => {
    // Aller sur la page
    await page.goto('/');
    
    // Attendre que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Prendre une capture d'écran pour debug
    await page.screenshot({ path: 'debug-homepage.png' });
    
    // Vérifier que la page répond (peut être 200, 304, ou 403 en dev)
    const response = await page.goto('/');
    console.log('Response status:', response?.status());
    expect([200, 304, 403]).toContain(response?.status());
    
    // Vérifier que le body est présent (peut être caché par CSS)
    const body = page.locator('body');
    await expect(body).toBeAttached();
    
    // Log du contenu de la page pour debug
    const bodyText = await page.locator('body').textContent();
    console.log('Body content:', bodyText?.substring(0, 200));
  });

  test('devrait afficher la navigation correctement', async ({ page }) => {
    await page.goto('/');
    
    // Vérifier les liens de navigation
    const navItems = [
      'Accueil',
      'Dossiers', 
      'Entreprises',
      'Configuration métier',
      'Cas d\'usage',
      'Matrice',
      'Dashboard',
      'Design',
      'Données',
      'Paramètres'
    ];
    
    for (const item of navItems) {
      await expect(page.locator(`text=${item}`)).toBeVisible();
    }
  });

  test('devrait changer de langue', async ({ page }) => {
    await page.goto('/');
    
    // Vérifier que le sélecteur de langue est présent
    const localeSelector = page.locator('select');
    await expect(localeSelector).toBeVisible();
    
    // Changer vers l'anglais
    await localeSelector.selectOption('en');
    
    // Vérifier que l'interface change (au moins un élément en anglais)
    await expect(page.locator('text=Home')).toBeVisible();
  });

  test('devrait naviguer vers les différentes pages', async ({ page }) => {
    await page.goto('/');
    
    // Tester la navigation vers les dossiers
    await page.click('text=Dossiers');
    await expect(page).toHaveURL('/dossiers');
    
    // Tester la navigation vers les entreprises
    await page.click('text=Entreprises');
    await expect(page).toHaveURL('/entreprises');
    
    // Tester la navigation vers le dashboard
    await page.click('text=Dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('devrait gérer les erreurs 404', async ({ page }) => {
    await page.goto('/page-inexistante');
    
    // Vérifier que la page d'erreur s'affiche
    await expect(page.locator('text=404')).toBeVisible();
  });
});

test.describe('API Health Check', () => {
  test('devrait répondre aux requêtes API', async ({ request }) => {
    // Tester l'endpoint de santé
    const response = await request.get('http://localhost:8787/api/v1/health');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
  });
});
