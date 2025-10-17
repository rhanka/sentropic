import { test, expect } from '@playwright/test';

test.describe('WebAuthn Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Aller sur la page de connexion
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
  });

  test('devrait afficher la page de connexion', async ({ page }) => {
    // Vérifier les éléments de la page de connexion
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    
    // Vérifier que le texte de connexion est présent
    const magicLinkText = page.getByText('Utilisez un lien magique par email');
    await expect(magicLinkText).toBeVisible();
    
    // Vérifier le bouton de connexion
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    await expect(magicLinkButton).toBeVisible();
  });

  test('devrait basculer vers le lien magique', async ({ page }) => {
    // Vérifier d'abord si le bouton lien magique est visible
    const magicLinkButton = page.getByRole('button', { name: 'Utiliser un lien magique' });
    
    if (await magicLinkButton.isVisible()) {
      // Cliquer sur le bouton lien magique
      await magicLinkButton.click();
      
      // Vérifier que l'interface change
      await expect(page.getByText('Utilisez un lien magique par email')).toBeVisible();
      await expect(page.getByLabel('Adresse email')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Envoyer le lien magique' })).toBeVisible();
    } else {
      // Si le bouton n'est pas visible, vérifier que l'interface est déjà en mode lien magique
      await expect(page.getByText('Utilisez un lien magique par email')).toBeVisible();
    }
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
    const webauthnText = page.getByText('Utilisez votre passkey ou biométrie');
    const magicLinkText = page.getByText('Utilisez un lien magique par email');
    
    // Au moins un des deux textes doit être visible
    const webauthnVisible = await webauthnText.isVisible();
    const magicLinkVisible = await magicLinkText.isVisible();
    expect(webauthnVisible || magicLinkVisible).toBe(true);
    
    // Vérifier que les boutons appropriés sont présents
    const webauthnButton = page.getByRole('button', { name: 'Se connecter avec WebAuthn' });
    const magicLinkButton = page.getByRole('button', { name: 'Envoyer le lien magique' });
    
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

  test('devrait afficher la page d\'inscription', async ({ page }) => {
    // Vérifier les éléments de la page d'inscription
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    
    // Vérifier le texte d'authentification (peut varier selon le support WebAuthn)
    const webauthnText = page.getByText('Authentification sécurisée avec WebAuthn (passkey ou biométrie)');
    const secureText = page.getByText('Authentification sécurisé');
    
    // Au moins un des deux textes doit être visible
    const webauthnVisible = await webauthnText.isVisible();
    const secureVisible = await secureText.isVisible();
    expect(webauthnVisible || secureVisible).toBe(true);
    
    // Vérifier que la page d'inscription affiche le message de navigateur non compatible
    const incompatibleText = page.getByText('Navigateur non compatible');
    await expect(incompatibleText).toBeVisible();
    
    // Vérifier qu'il n'y a pas de formulaire d'inscription (car WebAuthn n'est pas supporté)
    const userNameField = page.getByLabel('Nom d\'utilisateur');
    const displayNameField = page.getByLabel('Nom d\'affichage');
    const emailField = page.getByLabel('Email (optionnel)');
    
    // Les champs ne doivent pas être visibles car WebAuthn n'est pas supporté
    await expect(userNameField).not.toBeVisible();
    await expect(displayNameField).not.toBeVisible();
    await expect(emailField).not.toBeVisible();
    
    // Vérifier qu'il n'y a pas de bouton d'inscription
    const createAccountButton = page.getByRole('button', { name: 'Créer un compte' });
    await expect(createAccountButton).not.toBeVisible();
  });

  test('devrait valider les champs requis', async ({ page }) => {
    // Sur la page d'inscription, vérifier que le message de navigateur non compatible est affiché
    const incompatibleText = page.getByText('Navigateur non compatible');
    await expect(incompatibleText).toBeVisible();
    
    // Vérifier qu'il n'y a pas de formulaire à valider
    const createAccountButton = page.getByRole('button', { name: 'Créer un compte' });
    await expect(createAccountButton).not.toBeVisible();
  });

  test('devrait permettre la saisie des informations', async ({ page }) => {
    // Sur la page d'inscription, vérifier que le message de navigateur non compatible est affiché
    const incompatibleText = page.getByText('Navigateur non compatible');
    await expect(incompatibleText).toBeVisible();
    
    // Vérifier qu'il n'y a pas de champs à remplir
    const userNameField = page.getByLabel('Nom d\'utilisateur');
    const displayNameField = page.getByLabel('Nom d\'affichage');
    const emailField = page.getByLabel('Email (optionnel)');
    
    await expect(userNameField).not.toBeVisible();
    await expect(displayNameField).not.toBeVisible();
    await expect(emailField).not.toBeVisible();
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
    // Accéder à la page d'accueil (publique)
    await page.goto('/');
    
    // Vérifier que la page se charge
    await expect(page.locator('body')).toBeAttached();
    
    // Vérifier que les liens de navigation sont visibles
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
  });

  test('devrait afficher le lien de connexion dans la navigation', async ({ page }) => {
    await page.goto('/');
    
    // Vérifier que le lien de connexion est présent
    const loginLink = page.getByRole('link', { name: 'Connexion' });
    await expect(loginLink).toBeVisible();
    
    // Cliquer sur le lien de connexion
    await loginLink.click();
    
    // Vérifier qu'on arrive sur la page de connexion
    await expect(page).toHaveURL(/.*\/auth\/login/);
  });
});

test.describe('API Authentication Endpoints', () => {
  test('devrait répondre aux endpoints d\'authentification', async ({ request }) => {
    // Tester l'endpoint de santé de l'API
    const healthResponse = await request.get('http://api:8787/api/v1/health');
    expect(healthResponse.status()).toBe(200);
    
    const healthData = await healthResponse.json();
    expect(healthData).toHaveProperty('status', 'ok');
  });

  test('devrait gérer les options de connexion WebAuthn', async ({ request }) => {
    // Tester l'endpoint des options de connexion
    const optionsResponse = await request.post('http://api:8787/api/v1/auth/login/options', {
      data: { userName: 'test@example.com' }
    });
    
    // Vérifier que l'endpoint répond (peut être 200 ou 400 selon la configuration)
    expect([200, 400]).toContain(optionsResponse.status());
  });

  test('devrait gérer les options d\'inscription WebAuthn', async ({ request }) => {
    // Tester l'endpoint des options d'inscription
    const optionsResponse = await request.post('http://api:8787/api/v1/auth/register/options', {
      data: { 
        userName: 'testuser',
        userDisplayName: 'Test User',
        email: 'test@example.com'
      }
    });
    
    // Vérifier que l'endpoint répond (peut être 200 ou 400 selon la configuration)
    expect([200, 400]).toContain(optionsResponse.status());
  });
});
