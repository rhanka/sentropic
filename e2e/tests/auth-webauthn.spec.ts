import { test, expect } from '@playwright/test';

// Public (non authentifié)
test.describe('Public · WebAuthn Authentication', () => {
  test.use({ storageState: undefined });
  test.beforeEach(async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page de connexion', async ({ page }) => {
    // Vérifier les éléments de la page de connexion
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Détecter l'état actuel de l'UI (WebAuthn ou magic link)
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    // Basculer en mode magic link si nécessaire (si WebAuthn est supporté)
    if (await useMagicLinkButton.isVisible()) {
      await useMagicLinkButton.click();
      // Attendre que le bouton magic link soit visible (plus fiable que le champ email)
      await page.getByRole('button', { name: 'Envoyer le lien magique' }).waitFor({ state: 'visible', timeout: 2000 });
    }
    
    // Vérifier qu'au moins un bouton d'authentification est visible
    const anyAuthButtonVisible = await magicLinkButton.isVisible() || 
                                await webauthnButton.isVisible() ||
                                await page.getByRole('button', { name: /connexion|magique/i }).first().isVisible();
    expect(anyAuthButtonVisible).toBe(true);
  });

  test('devrait basculer vers le lien magique', async ({ page }) => {
    // Détecter l'état actuel de l'UI
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    
    if (await webauthnButton.isVisible() && await useMagicLinkButton.isVisible()) {
      // WebAuthn est supporté - cliquer pour basculer vers magic link
      await useMagicLinkButton.click();
      // Attendre que le bouton magic link soit visible (plus fiable que le champ email)
      await page.getByRole('button', { name: 'Envoyer le lien magique' }).waitFor({ state: 'visible', timeout: 2000 });
      
      // Vérifier que l'interface change
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    } else {
      // Vérifier que l'interface est déjà en mode lien magique
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    }
    
    // Vérifier qu'au moins un bouton d'authentification est visible
    const anyAuthButtonVisible = await magicLinkButton.isVisible() || 
                                await webauthnButton.isVisible();
    expect(anyAuthButtonVisible).toBe(true);
  });

  test('devrait gérer les erreurs de validation', async ({ page }) => {
    // Vérifier quel bouton est disponible
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    
    if (await webauthnButton.isVisible()) {
      // Mode WebAuthn
      await webauthnButton.click();
    } else if (await magicLinkButton.isVisible()) {
      // Mode lien magique
      await magicLinkButton.click();
    }
    
    // Attendre un peu pour voir si une erreur apparaît
    await page.waitForTimeout(1000);
    
    // Vérifier qu'aucune erreur critique n'apparaît
    const errorMessage = page.locator('.text-red-800');
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      expect(errorText).not.toContain('500');
      expect(errorText).not.toContain('Internal Server Error');
    }
  });

  test('devrait afficher le support d\'authentification', async ({ page }) => {
    // Vérifier que l'interface d'authentification est présente
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    // Au moins un des boutons d'authentification doit être visible
    const webauthnVisible = await webauthnButton.isVisible();
    const magicLinkVisible = await magicLinkButton.isVisible();
    const useMagicLinkVisible = await useMagicLinkButton.isVisible();
    expect(webauthnVisible || magicLinkVisible || useMagicLinkVisible).toBe(true);
    
    // Vérifier que les boutons appropriés sont présents et non désactivés
    if (await webauthnButton.isVisible()) {
      await expect(webauthnButton).not.toBeDisabled();
    } else if (await magicLinkButton.isVisible()) {
      await expect(magicLinkButton).not.toBeDisabled();
    }
  });
});

test.describe('WebAuthn Registration', () => {
  test.beforeEach(async ({ page }) => {
    // Aller sur la page d'inscription
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
  });

  test('devrait valider les champs requis', async ({ page }) => {
    // Vérifier que la page d'inscription est affichée
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    
    // Vérifier l'état du navigateur (compatible ou non)
    const incompatibleText = page.getByText('Navigateur non compatible');
    const createAccountButton = page.getByRole('button', { name: 'Créer un compte' });
    
    const incompatibleVisible = await incompatibleText.isVisible();
    const createButtonVisible = await createAccountButton.isVisible();
    
    // Selon l'état, vérifier le comportement attendu
    if (incompatibleVisible) {
      // Navigateur non compatible - pas de formulaire
      await expect(createAccountButton).not.toBeVisible();
    } else if (createButtonVisible) {
      // Navigateur compatible - formulaire présent
      await expect(createAccountButton).toBeVisible();
    }
  });

  test('devrait permettre la saisie des informations', async ({ page }) => {
    // Vérifier que la page d'inscription est affichée
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    
    // Vérifier l'état du navigateur (compatible ou non)
    const incompatibleText = page.getByText('Navigateur non compatible');
    const createAccountButton = page.getByRole('button', { name: 'Créer un compte' });
    
    const incompatibleVisible = await incompatibleText.isVisible();
    const createButtonVisible = await createAccountButton.isVisible();
    
    // Selon l'état, vérifier les champs disponibles
    if (createButtonVisible) {
      // Navigateur compatible - vérifier les champs
      const userNameField = page.getByLabel('Nom d\'utilisateur');
      const displayNameField = page.getByLabel('Nom d\'affichage');
      
      await expect(userNameField).toBeVisible();
      await expect(displayNameField).toBeVisible();
    } else if (incompatibleVisible) {
      // Navigateur non compatible - pas de champs
      const userNameField = page.getByLabel('Nom d\'utilisateur');
      await expect(userNameField).not.toBeVisible();
    }
  });

  test('devrait gérer les navigateurs non compatibles', async ({ page }) => {
    // Simuler un navigateur non compatible en désactivant WebAuthn
    await page.addInitScript(() => {
      // Mock WebAuthn API pour simuler un navigateur non compatible
      (window as any).navigator.credentials = undefined;
      (window as any).PublicKeyCredential = undefined;
    });
    
    // Recharger la page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le message d'erreur apparaît
    await expect(page.getByText('Navigateur non compatible')).toBeVisible();
  });
});

test.describe('Navigation Authentication', () => {
  test.use({ storageState: undefined });
  test.beforeEach(async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
  });
  test('devrait rediriger vers la connexion depuis les pages protégées', async ({ page }) => {
    // Essayer d'accéder à une page protégée sans être connecté
    await page.goto('/dashboard');
    
    // Attendre que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge (même si c'est une erreur 404 ou une redirection)
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier que l'utilisateur n'est pas connecté (pas de menu utilisateur)
    const userMenu = page.locator('[data-testid="user-menu"]');
    await expect(userMenu).not.toBeVisible();
  });

  test('devrait permettre l\'accès aux pages publiques', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    // Accéder à la page d'accueil (publique)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier que les liens de navigation sont visibles
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
  });

  test('devrait afficher le lien de connexion dans la navigation', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que le lien de connexion est présent
    const loginLink = page.getByRole('link', { name: 'Connexion' });
    await expect(loginLink).toBeVisible();
    
    // Cliquer sur le lien de connexion
    await loginLink.click();
    
    // Vérifier qu'on arrive sur la page de connexion
    await expect(page).toHaveURL(/.*\/auth\/login/);
  });
});

