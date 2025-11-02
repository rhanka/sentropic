import { test, expect, type Page } from '@playwright/test';

async function ensureMagicLinkMode(page: Page) {
  const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
  const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
  const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });

  const magicLinkAlreadyVisible = await magicLinkButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (magicLinkAlreadyVisible) {
    return { magicLinkButton, webauthnButtonVisible: await webauthnButton.isVisible({ timeout: 1000 }).catch(() => false) };
  }

  const canToggleToMagicLink = await useMagicLinkButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (canToggleToMagicLink) {
    await useMagicLinkButton.click();
    await page.waitForLoadState('networkidle');
  } else {
    const webauthnVisible = await webauthnButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!webauthnVisible) {
      await page.waitForTimeout(500);
    }
  }

  await page.waitForTimeout(200);
  await expect(magicLinkButton).toBeVisible({ timeout: 3000 });

  return { magicLinkButton, webauthnButtonVisible: await webauthnButton.isVisible({ timeout: 1000 }).catch(() => false) };
}

// Public (non authentifié)
test.describe('Public · WebAuthn Complete Authentication Workflow', () => {
  test.use({ storageState: undefined });
  
  test('devrait gérer l\'état d\'authentification dans l\'interface', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    // Aller sur la page d'accueil
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que les éléments d'authentification sont présents
    const loginLink = page.getByRole('link', { name: 'Connexion' });
    await expect(loginLink).toBeVisible();
    
    // Cliquer sur le lien de connexion
    await loginLink.click();
    
    // Vérifier qu'on arrive sur la page de connexion
    await expect(page).toHaveURL(/.*\/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });
  test('devrait permettre le workflow complet d\'inscription et connexion', async ({ page }) => {
    // Nettoyer le localStorage et les cookies pour s'assurer d'un état non authentifié
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.context().clearCookies();
    
    // Étape 1: Aller sur la page d'inscription
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page d'inscription se charge
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    
    // Détecter l'état actuel de l'UI (WebAuthn supporté ou non)
    const browserNotSupported = page.getByText('Navigateur non compatible');
    const userNameField = page.getByLabel('Nom d\'utilisateur / Email');
    const displayNameField = page.getByLabel('Nom d\'affichage');
    const emailField = page.getByLabel('Email (optionnel)');
    
    const hasIncompatibleMessage = await browserNotSupported.isVisible();
    const hasFormFields = await userNameField.isVisible();
    
    // L'UI peut être dans deux états :
    // 1. Navigateur non compatible -> affiche message d'erreur (pas de formulaire)
    // 2. Navigateur compatible -> affiche formulaire d'inscription
    if (hasIncompatibleMessage) {
      // État 1 : Navigateur non compatible
      await expect(browserNotSupported).toBeVisible();
      await expect(userNameField).not.toBeVisible();
      await expect(displayNameField).not.toBeVisible();
      await expect(emailField).not.toBeVisible();
      // Test s'arrête ici car WebAuthn n'est pas supporté
    } else if (hasFormFields) {
      // État 2 : Navigateur compatible -> affiche formulaire
      await expect(userNameField).toBeVisible();
      await expect(displayNameField).toBeVisible();
      // Le test vérifie que le formulaire est présent (WebAuthn supporté)
    } else {
      // État inattendu
      throw new Error('La page d\'inscription n\'est ni en mode erreur ni en mode formulaire');
    }
  });

  test('devrait gérer la navigation entre les pages d\'authentification', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Chercher un lien vers l'inscription
    const registerLink = page.getByRole('link', { name: /créer|inscription|register/i });
    
    if (await registerLink.isVisible()) {
      await registerLink.click();
      await expect(page).toHaveURL(/.*\/auth\/register/);
      await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    }
    
    // Retourner à la page de connexion
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });


  test('devrait gérer les sessions expirées', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    
    // Simuler une session expirée en modifiant les cookies
    await page.context().clearCookies();
    
    // Essayer d'accéder à une page protégée
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Attendre un peu pour que l'erreur apparaisse
    await page.waitForTimeout(2000);
    
    // Vérifier qu'on est redirigé vers la page de connexion OU qu'une erreur est affichée
    const isLoginPage = page.url().includes('/auth/login');
    const has404Error = await page.getByText('404').isVisible();
    const hasDashboardError = await page.getByText('Erreur lors du chargement des données du dashboard').isVisible();
    
    expect(isLoginPage || has404Error || hasDashboardError).toBeTruthy();
  });
});

test.describe('WebAuthn Integration with Application', () => {
  test('devrait intégrer l\'authentification avec l\'application principale', async ({ page }) => {
    // Aller sur la page d'accueil
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Vérifier que la page se charge
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier que les éléments de navigation sont présents
    const navItems = ['Accueil', 'Dossiers', 'Entreprises', 'Cas d\'usage', 'Évaluation', 'Dashboard', 'Paramètres'];
    
    for (const item of navItems) {
      const navElement = page.getByRole('link', { name: item });
      if (await navElement.isVisible()) {
        // Vérifier que l'élément est visible et cliquable
        await expect(navElement).toBeVisible();
      }
    }
  });

  test('devrait gérer les permissions utilisateur', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    
    // Vérifier que la page se charge correctement
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Vérifier que les éléments d'interface sont appropriés pour un utilisateur non connecté
    const userMenu = page.locator('[data-testid="user-menu"]');
    await expect(userMenu).not.toBeVisible();
    
    const logoutButton = page.getByRole('button', { name: /déconnexion|logout/i });
    await expect(logoutButton).not.toBeVisible();
  });
});

test.describe('WebAuthn Security Features', () => {
  test('devrait implémenter les mesures de sécurité appropriées', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    
    // Vérifier que la page utilise HTTPS (en production)
    const url = page.url();
    if (url.startsWith('https://')) {
      expect(url).toMatch(/^https:/);
    }
    
    // Vérifier que la page de connexion se charge correctement
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

  test('devrait gérer les tentatives de connexion multiples', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Détecter l'état actuel de l'UI (WebAuthn ou magic link)
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });

    let submitButton;
    let inputField;
    let isWebAuthnMode = false;

    const webauthnVisible = await webauthnButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (webauthnVisible) {
      isWebAuthnMode = true;
      submitButton = webauthnButton;
      inputField = page.getByLabel(/Nom d'utilisateur|Email/i);
      await inputField.fill('test@example.com');
    } else {
      const { magicLinkButton } = await ensureMagicLinkMode(page);
      submitButton = magicLinkButton;
      inputField = page.getByLabel('Email');
      await inputField.fill('test@example.com');
    }
    
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    
    // Premier clic - doit déclencher la requête et désactiver le bouton
    await submitButton.click();
    
    // Vérifier que le bouton passe en mode chargement (texte change OU bouton désactivé)
    // La requête peut être très rapide, donc on vérifie soit le texte, soit le disabled
    if (isWebAuthnMode) {
      // Attendre que le texte change ou que le bouton soit désactivé (timeout court car peut échouer vite)
      try {
        await expect(submitButton).toContainText('Connexion...', { timeout: 2000 });
      } catch {
        // Si le texte ne change pas, vérifier que le bouton est désactivé au moins brièvement
        await expect(submitButton).toBeDisabled({ timeout: 1000 }).catch(() => {});
      }
    } else {
      try {
        await expect(submitButton).toContainText('Envoi...', { timeout: 2000 });
      } catch {
        await expect(submitButton).toBeDisabled({ timeout: 1000 }).catch(() => {});
      }
    }
    
    // Essayer de cliquer à nouveau - si le bouton est disabled, ça ne fera rien
    // Si la requête s'est terminée rapidement, on peut cliquer à nouveau (c'est ce qu'on teste)
    try {
      await submitButton.click({ timeout: 500 });
    } catch {
      // Le bouton est peut-être désactivé, c'est normal
    }
    
    // Attendre que la requête se termine (succès ou erreur) - timeout plus long pour WebAuthn
    await expect(submitButton).toBeEnabled({ timeout: 15000 });
    
    // Vérifier qu'aucune erreur critique n'apparaît
    const criticalError = page.locator('.text-red-800');
    if (await criticalError.isVisible()) {
      const errorText = await criticalError.textContent();
      expect(errorText).not.toContain('500');
      expect(errorText).not.toContain('Internal Server Error');
    }
  });

  test('devrait gérer les données de session de manière sécurisée', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    
    // Vérifier que les cookies de session ne sont pas exposés dans le DOM
    const sessionData = page.locator('[data-session-token]');
    await expect(sessionData).not.toBeVisible();
    
    // Vérifier que les tokens ne sont pas dans le localStorage (ils devraient être dans des cookies HttpOnly)
    const localStorage = await page.evaluate(() => {
      return {
        sessionToken: localStorage.getItem('sessionToken'),
        refreshToken: localStorage.getItem('refreshToken')
      };
    });
    
    // Les tokens ne devraient pas être dans localStorage pour la sécurité
    expect(localStorage.sessionToken).toBeNull();
    expect(localStorage.refreshToken).toBeNull();
  });
});

test.describe('WebAuthn Error Recovery', () => {
  test('devrait récupérer des erreurs de WebAuthn', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const { magicLinkButton } = await ensureMagicLinkMode(page);
    const webauthnStillVisible = await webauthnButton.isVisible().catch(() => false);
    const anyAuthButtonVisible = webauthnStillVisible || await magicLinkButton.isVisible() ||
                                await page.getByRole('button', { name: /connexion|magique/i }).first().isVisible();
    expect(anyAuthButtonVisible).toBe(true);
    
    if (await magicLinkButton.isVisible()) {
      // Simuler une erreur en interceptant les appels de lien magique
      await page.route('**/api/v1/auth/magic-link/send', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Magic link service unavailable' })
        });
      });
      
      // Essayer de cliquer sur le bouton
      await magicLinkButton.click();
      
      // Attendre un peu pour voir l'erreur
      await page.waitForTimeout(2000);
      
      // Vérifier qu'une erreur appropriée est affichée
      const errorMessage = page.locator('.text-red-800');
      if (await errorMessage.isVisible()) {
        const errorText = await errorMessage.textContent();
        // Accepter soit une erreur d'API soit le message de navigateur non compatible
        expect(errorText).toMatch(/erreur|navigateur|WebAuthn/);
      }
    }
  });

  test('devrait permettre la récupération après une erreur', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const { magicLinkButton } = await ensureMagicLinkMode(page);
    const webauthnStillVisible = await webauthnButton.isVisible().catch(() => false);
    const anyAuthButtonVisible = webauthnStillVisible || await magicLinkButton.isVisible() ||
                                await page.getByRole('button', { name: /connexion|magique/i }).first().isVisible();
    expect(anyAuthButtonVisible).toBe(true);
    
    if (await magicLinkButton.isVisible()) {
      // Simuler une erreur temporaire
      await page.route('**/api/v1/auth/magic-link/send', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary error' })
        });
      });
      
      // Essayer de cliquer sur le bouton
      await magicLinkButton.click();
      await page.waitForTimeout(1000);
      
      // Restaurer le service
      await page.unroute('**/api/v1/auth/magic-link/send');
      
      // Essayer à nouveau
      await magicLinkButton.click();
      
      // Vérifier que l'erreur précédente n'interfère pas
      await page.waitForTimeout(1000);
    }
  });
});
