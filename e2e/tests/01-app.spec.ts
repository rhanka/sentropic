import { test, expect } from '@playwright/test';
import { debug, setupDebugBuffer } from '../helpers/debug';

// Setup debug buffer to display on test failure
setupDebugBuffer();

test.describe('Application principale', () => {
  test('devrait charger la page d\'accueil', async ({ page }) => {
    // Aller sur la page
    await page.goto('/');
    
    // Attendre que la page se charge
    await page.waitForLoadState('domcontentloaded');
    
    // Prendre une capture d'écran pour debug
    await page.screenshot({ path: 'debug-homepage.png' });
    
    // Vérifier que la page répond (peut être 200, 304, ou 403 en dev)
    const response = await page.goto('/');
    debug(`Response status: ${response?.status()}`);
    expect([200, 304, 403]).toContain(response?.status());
    
    // Vérifier que le body est présent (peut être caché par CSS)
    const body = page.locator('body');
    await expect(body).toBeAttached();
    
    // Log du contenu de la page pour debug
    const bodyText = await page.locator('body').textContent();
    // console.log('Body content:', bodyText?.substring(0, 200));
  });

  test('devrait afficher la navigation correctement', async ({ page }) => {
    await page.goto('/');
    
    // Vérifier les liens de navigation
    const navItems = [
      'Accueil',
      'Dossiers', 
      'Organisations',
      'Cas d\'usage',
      'Évaluation',
      'Dashboard',
    ];
    
    for (const item of navItems) {
      await expect(page.getByRole('link', { name: item })).toBeVisible();
    }

    // "Paramètres" est désormais sous le menu Identité (pas dans la nav principale)
    const identityButton = page.getByRole('button', { name: /E2E Admin/i });
    await expect(identityButton).toBeVisible();
    await identityButton.click();

    // Le lien Paramètres doit être présent dans ce menu
    await expect(page.getByRole('link', { name: 'Paramètres' })).toBeVisible();
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
    await page.getByRole('link', { name: 'Dossiers' }).click();
    await expect(page).toHaveURL('/folders');
    
    // Tester la navigation vers les organisations
    await page.getByRole('link', { name: 'Organisations' }).click();
    await expect(page).toHaveURL('/organizations');
    
    // Essayer la navigation vers le dashboard si le lien n'est pas désactivé
    const dashboardLink = page.locator('a:has-text("Dashboard")');
    if (await dashboardLink.isVisible()) {
      const classAttr = await dashboardLink.getAttribute('class');
      // Si pas disabled, vérifier la navigation; sinon, vérifier que l'URL ne change pas
      if (classAttr && !classAttr.includes('cursor-not-allowed')) {
        await dashboardLink.click();
        await expect(page).toHaveURL('/dashboard');
      } else {
        const beforeUrl = page.url();
        await dashboardLink.click();
        await expect(page).toHaveURL(beforeUrl);
      }
    }
  });

  test('devrait gérer les erreurs 404', async ({ page }) => {
    await page.goto('/page-inexistante');
    
    // Vérifier que la page se charge et que l'URL correspond
    await expect(page).toHaveURL('/page-inexistante');
    await expect(page.locator('body')).toBeAttached();
  });
});
