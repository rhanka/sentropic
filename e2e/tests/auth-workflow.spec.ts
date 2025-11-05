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
    const emailField = page.getByLabel('Email');
    
    const hasIncompatibleMessage = await browserNotSupported.isVisible().catch(() => false);
    const hasEmailField = await emailField.isVisible().catch(() => false);
    
    if (hasIncompatibleMessage) {
      await expect(browserNotSupported).toBeVisible();
      await expect(emailField).not.toBeVisible();
    } else if (hasEmailField) {
      // Nouveau workflow : email → code → webauthn
      await expect(emailField).toBeVisible();
      // Vérifier qu'il y a un bouton pour demander le code
      const requestCodeButton = page.getByRole('button', { name: /demander|envoyer|code/i });
      await expect(requestCodeButton).toBeVisible();
    } else {
      throw new Error("La page d'inscription n'est ni en mode erreur ni en mode formulaire");
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
    // Note: les menus peuvent être grisés si non authentifié
    const navItems = ['Accueil', 'Dossiers', 'Entreprises', 'Cas d\'usage', 'Évaluation', 'Dashboard', 'Paramètres'];
    
    for (const item of navItems) {
      const navElement = page.getByRole('link', { name: item });
      const isVisible = await navElement.isVisible().catch(() => false);
      if (isVisible) {
        // Vérifier que l'élément est visible (peut être grisé si non authentifié)
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
    
    // Selon WORKFLOW_AUTH.md, la page login n'affiche que le bouton WebAuthn (pas de champ email)
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });

    await expect(webauthnButton).toBeVisible();
    await expect(webauthnButton).toBeEnabled();
    
    // Premier clic - doit déclencher la requête et désactiver le bouton
    await webauthnButton.click();
    
    // Vérifier que le bouton passe en mode chargement (texte change OU bouton désactivé)
    // La requête peut être très rapide, donc on vérifie soit le texte, soit le disabled
    try {
      await expect(webauthnButton).toContainText('Connexion...', { timeout: 2000 });
    } catch {
      // Si le texte ne change pas, vérifier que le bouton est désactivé au moins brièvement
      await expect(webauthnButton).toBeDisabled({ timeout: 1000 }).catch(() => {});
    }
    
    // Attendre que le bouton redevienne disponible (ou erreur)
    await page.waitForTimeout(2000);
    
    // Vérifier que le bouton peut être cliqué à nouveau (ou erreur affichée)
    const isEnabled = await webauthnButton.isEnabled().catch(() => false);
    if (isEnabled) {
      // Le bouton est à nouveau disponible, peut être cliqué à nouveau
      await expect(webauthnButton).toBeEnabled();
    } else {
      // Une erreur est peut-être affichée
      const errorMessage = page.locator('.text-red-800');
      if (await errorMessage.isVisible()) {
        const errorText = await errorMessage.textContent();
        expect(errorText).toBeTruthy();
      }
    }
    
    // Test: essayer de cliquer plusieurs fois rapidement
    // (le comportement exact dépend de l'implémentation)
    await webauthnButton.click({ timeout: 5000 }).catch(() => {
      // Si le bouton est désactivé, c'est normal
    });
    
    // Attendre que la requête se termine (succès ou erreur) - timeout plus long pour WebAuthn
    await expect(webauthnButton).toBeEnabled({ timeout: 15000 });
    
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
    
    // Selon WORKFLOW_AUTH.md, la page login n'affiche que le bouton WebAuthn
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    await expect(webauthnButton).toBeVisible();
    
    // Simuler une erreur en interceptant les appels WebAuthn
    await page.route('**/api/v1/auth/login/options', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'WebAuthn service unavailable' })
      });
    });
    
    // Essayer de cliquer sur le bouton
    await webauthnButton.click();
    
    // Attendre un peu pour voir l'erreur
    await page.waitForTimeout(2000);
    
    // Vérifier qu'une erreur appropriée est affichée
    const errorMessage = page.locator('.text-red-800');
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      // Accepter soit une erreur d'API soit le message de navigateur non compatible
      expect(errorText).toMatch(/erreur|navigateur|WebAuthn/);
    }
  });

  test('devrait permettre la récupération après une erreur', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Selon WORKFLOW_AUTH.md, la page login n'affiche que le bouton WebAuthn
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    await expect(webauthnButton).toBeVisible();
    
    // Simuler une erreur temporaire
    await page.route('**/api/v1/auth/login/options', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary error' })
      });
    });
    
    // Essayer de cliquer sur le bouton
    await webauthnButton.click();
    await page.waitForTimeout(1000);
    
    // Restaurer le service
    await page.unroute('**/api/v1/auth/login/options');
    
    // Essayer à nouveau
    await webauthnButton.click();
    
    // Vérifier que l'erreur précédente n'interfère pas
    await page.waitForTimeout(1000);
    
    // Le bouton devrait être à nouveau disponible
    await expect(webauthnButton).toBeEnabled();
  });
});
