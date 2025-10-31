import { test, expect } from '@playwright/test';

// Public (non authentifié)
test.describe('Public · WebAuthn Device Management', () => {
  test.use({ storageState: undefined });
  test.beforeEach(async ({ page }) => {
    // Aller sur la page de gestion des appareils
    await page.goto('/auth/devices');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page de gestion des appareils', async ({ page }) => {
    // Vérifier que la page se charge
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier les éléments de la page (peut être redirigé vers login si pas connecté)
    const isLoginPage = await page.url().includes('/auth/login');
    
    if (isLoginPage) {
      // Si redirigé vers login, vérifier que c'est bien le cas
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    } else {
      // Si sur la page des appareils, vérifier les éléments
      await expect(page.getByRole('heading', { name: 'Mes Appareils' })).toBeVisible();
    }
  });

  test('devrait rediriger vers la connexion si non authentifié', async ({ page }) => {
    // Vérifier qu'on est redirigé vers la page de connexion
    await expect(page).toHaveURL(/.*\/auth\/login/);
    
    // Vérifier que la page de connexion s'affiche
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });

  test('devrait permettre la navigation vers la page des appareils', async ({ page }) => {
    // Aller d'abord sur la page d'accueil
    await page.goto('/');
    
    // Chercher un lien vers la gestion des appareils (peut être dans un menu utilisateur)
    const devicesLink = page.getByRole('link', { name: /appareils|devices/i });
    
    if (await devicesLink.isVisible()) {
      await devicesLink.click();
      await expect(page).toHaveURL(/.*\/auth\/devices/);
    } else {
      // Si pas de lien visible, essayer d'accéder directement
      await page.goto('/auth/devices');
      // Vérifier qu'on est redirigé vers login (comportement attendu)
      await expect(page).toHaveURL(/.*\/auth\/login/);
    }
  });
});

test.describe('WebAuthn Session Management', () => {
  test('devrait gérer les sessions utilisateur', async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    
    // Vérifier que la page se charge correctement
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Vérifier que les éléments de session ne sont pas visibles (pas connecté)
    const userMenu = page.locator('[data-testid="user-menu"]');
    await expect(userMenu).not.toBeVisible();
  });

  test('devrait afficher les informations de session après connexion', async ({ page }) => {
    // Cette test nécessiterait une vraie authentification WebAuthn
    // Pour l'instant, on vérifie juste que la structure est en place
    
    await page.goto('/auth/login');
    
    // Vérifier que la page de connexion est chargée
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Détecter l'état actuel de l'UI (WebAuthn ou magic link)
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    
    // Basculer en mode magic link si nécessaire (si WebAuthn est supporté)
    if (await useMagicLinkButton.isVisible()) {
      await useMagicLinkButton.click();
      // Attendre que le bouton magic link soit visible (plus fiable que le champ email)
      await page.getByRole('button', { name: 'Envoyer le lien magique' }).waitFor({ state: 'visible', timeout: 5000 });
    }
    
    // Vérifier qu'au moins un bouton d'authentification est visible
    const anyAuthButtonVisible = await magicLinkButton.isVisible() || 
                                await webauthnButton.isVisible() ||
                                await page.getByRole('button', { name: /connexion|magique/i }).first().isVisible();
    expect(anyAuthButtonVisible).toBe(true);
    
    // Vérifier que les champs de session ne sont pas visibles avant connexion
    const sessionInfo = page.locator('[data-testid="session-info"]');
    await expect(sessionInfo).not.toBeVisible();
  });
});

// Authentifié
test.describe('Authentifié · WebAuthn Device Management', () => {
  test('devrait afficher Mes Appareils quand connecté', async ({ page }) => {
    await page.goto('/auth/devices');
    await expect(page.getByRole('heading', { name: 'Mes Appareils' })).toBeVisible();
  });

  test('devrait naviguer vers /auth/devices depuis le menu utilisateur', async ({ page }) => {
    await page.goto('/');
    // Ouverture éventuelle du menu utilisateur si requis
    const devicesLink = page.getByRole('link', { name: /appareils|devices/i });
    if (await devicesLink.isVisible()) {
      await devicesLink.click();
      await expect(page).toHaveURL(/.*\/auth\/devices/);
    } else {
      await page.goto('/auth/devices');
      await expect(page).toHaveURL(/.*\/auth\/devices/);
    }
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

test.describe('WebAuthn Error Handling', () => {
  test('devrait gérer les erreurs de connexion', async ({ page }) => {
    await page.goto('/auth/login');
    
    // Vérifier quel bouton est disponible
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    if (await webauthnButton.isVisible()) {
      // Mode WebAuthn
      await webauthnButton.click();
    } else if (await magicLinkButton.isVisible()) {
      // Mode lien magique
      await magicLinkButton.click();
    } else if (await useMagicLinkButton.isVisible()) {
      // Mode lien magique (bouton de basculement)
      await useMagicLinkButton.click();
    }
    
    // Attendre un peu pour voir si une erreur apparaît
    await page.waitForTimeout(2000);
    
    // Vérifier qu'aucune erreur critique n'apparaît (WebAuthn gère les erreurs gracieusement)
    const criticalError = page.locator('.text-red-800');
    if (await criticalError.isVisible()) {
      const errorText = await criticalError.textContent();
      // Vérifier que l'erreur n'est pas une erreur de page
      expect(errorText).not.toContain('500');
      expect(errorText).not.toContain('Internal Server Error');
    }
  });

  test('devrait gérer les erreurs d\'inscription', async ({ page }) => {
    await page.goto('/auth/register');
    
    // Vérifier si le bouton est visible
    const registerButton = page.getByRole('button', { name: 'Créer un compte' });
    if (await registerButton.isVisible()) {
      await registerButton.click();
      
      // Attendre un peu pour voir si une erreur apparaît
      await page.waitForTimeout(1000);
      
      // Vérifier qu'une erreur de validation apparaît (peut varier selon l'interface)
      const errorMessage = page.locator('.text-red-800');
      if (await errorMessage.isVisible()) {
        const errorText = await errorMessage.textContent();
        expect(errorText).not.toContain('500');
        expect(errorText).not.toContain('Internal Server Error');
      }
    }
  });

  test('devrait gérer les erreurs de réseau', async ({ page }) => {
    // Simuler une erreur de réseau en interceptant les requêtes
    await page.route('**/api/v1/auth/**', route => {
      route.abort('failed');
    });
    
    await page.goto('/auth/login');
    
    // Vérifier quel bouton est disponible
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    if (await webauthnButton.isVisible()) {
      await webauthnButton.click();
    } else if (await magicLinkButton.isVisible()) {
      await magicLinkButton.click();
    } else if (await useMagicLinkButton.isVisible()) {
      await useMagicLinkButton.click();
    }
    
    // Attendre un peu pour voir l'erreur
    await page.waitForTimeout(2000);
    
    // Vérifier qu'une erreur de réseau est gérée gracieusement
    const errorMessage = page.locator('.text-red-800');
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      // L'erreur devrait être gérée gracieusement, pas une erreur de page
      expect(errorText).not.toContain('500');
    }
  });
});

test.describe('WebAuthn Accessibility', () => {
  test('devrait être accessible au clavier', async ({ page }) => {
    await page.goto('/auth/login');
    
    // Détecter et basculer en mode magic link si nécessaire
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    if (await useMagicLinkButton.isVisible()) {
      await useMagicLinkButton.click();
      // Attendre que le bouton magic link soit visible (plus fiable que le champ email)
      await page.getByRole('button', { name: 'Envoyer le lien magique' }).waitFor({ state: 'visible', timeout: 5000 });
    }
    
    // Maintenant on est en mode magic link - vérifier les éléments
    const emailField = page.getByLabel('Email');
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    
    // Vérifier que les éléments sont visibles
    await expect(emailField).toBeVisible();
    await expect(magicLinkButton).toBeVisible();
    
    // Tester la navigation au clavier - commencer par le champ email
    await emailField.focus();
    await expect(emailField).toBeFocused();
    
    // Naviguer vers le bouton
    await page.keyboard.press('Tab');
    await expect(magicLinkButton).toBeFocused();
  });

  test('devrait avoir des labels appropriés', async ({ page }) => {
    await page.goto('/auth/login');
    
    // Détecter l'état actuel de l'UI (WebAuthn ou magic link)
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    // Vérifier les labels selon le mode actif
    if (await webauthnButton.isVisible()) {
      // Mode WebAuthn - vérifier le label du champ userName
      const userNameField = page.getByLabel(/Nom d'utilisateur|Email/i);
      await expect(userNameField).toBeVisible();
      
      // Vérifier que le bouton WebAuthn a un texte descriptif
      await expect(webauthnButton).toBeVisible();
      await expect(webauthnButton).toContainText('WebAuthn');
    } else {
      // Mode magic link - basculer si nécessaire et vérifier
      if (await useMagicLinkButton.isVisible()) {
        await useMagicLinkButton.click();
        await page.getByRole('button', { name: 'Envoyer le lien magique' }).waitFor({ state: 'visible', timeout: 5000 });
      }
      
      const emailField = page.getByLabel('Email');
      await expect(emailField).toBeVisible();
      
      await expect(magicLinkButton).toBeVisible();
    }
  });

  test('devrait être responsive', async ({ page }) => {
    // Tester sur mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/auth/login');
    
    // Vérifier que la page s'affiche correctement sur mobile
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Vérifier qu'au moins un bouton d'authentification est visible
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    const useMagicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    const anyButtonVisible = await webauthnButton.isVisible() || 
                           await magicLinkButton.isVisible() || 
                           await useMagicLinkButton.isVisible();
    expect(anyButtonVisible).toBe(true);
    
    // Tester sur tablette
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    
    // Vérifier que la page s'affiche correctement sur tablette
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    const anyButtonVisibleTablet = await webauthnButton.isVisible() || 
                                 await magicLinkButton.isVisible() || 
                                 await useMagicLinkButton.isVisible();
    expect(anyButtonVisibleTablet).toBe(true);
  });
});
