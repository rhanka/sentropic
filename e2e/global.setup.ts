import { chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { debug, displayDebugOnFailure, clearDebugBuffer } from './helpers/debug-global-setup';

const STORAGE_STATE_PATH = './.auth/state.json';
const BASE_URL = process.env.UI_BASE_URL || 'http://localhost:5173';
const TEST_USER = {
  userName: 'e2e-admin@example.com',
  userDisplayName: 'E2E Admin',
  email: 'e2e-admin@example.com',
};

async function setupWebAuthn(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  
  // Configuration optimale selon la documentation Playwright
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal', // Authentificateur platform
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true // Important pour que l'authentificateur réponde automatiquement
    },
  });
  
  debug(`Virtual WebAuthn authenticator configured with ID: ${authenticatorId}`);
  
  // Ajouter un listener pour les événements de credentials (comme dans la doc Corbado)
  client.on('WebAuthn.credentialAdded', () => {
    debug('✅ Credential Added!');
  });
  
  // Attendre que l'authentificateur virtuel soit complètement initialisé
  debug('Waiting for virtual authenticator to be fully initialized...');
  await page.waitForTimeout(1000);
  
  // L'authentificateur virtuel devrait automatiquement fournir les APIs WebAuthn
  // Pas besoin de les injecter manuellement
  debug('✅ Virtual authenticator ready - WebAuthn APIs should be available');
  
  return { client, authenticatorId };
}

async function enrollOrLogin(page: Page, client: any, authenticatorId: string) {
  // Toujours faire l'enrôlement (pas de détection de session existante)
  debug('Proceeding with enrollment');
  
  // Ajouter des listeners pour capturer les erreurs
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('credentials') || text.includes('E2E') || text.includes('error') || text.includes('Error') || text.includes('WebAuthn')) {
      debug(`[Page Console] ${msg.type()}: ${text}`);
    }
  });
  
  page.on('pageerror', (error) => {
    debug(`[Page Error] ${error.message}`);
  });
  
  // Enrôlement WebAuthn minimal via UI
  await page.goto(`${BASE_URL}/auth/register`);
  await page.waitForLoadState('networkidle');
  debug(`On register page - URL: ${page.url()}`);

  // Vérifier si WebAuthn est disponible via l'API du navigateur (vérification robuste)
  const webAuthnInfo = await page.evaluate(() => {
    return {
      hasPublicKeyCredential: window.PublicKeyCredential && typeof window.PublicKeyCredential === 'function',
      hasNavigatorCredentials: typeof navigator.credentials !== 'undefined',
      hasCreate: typeof navigator.credentials?.create === 'function',
      userAgent: navigator.userAgent,
      isSecureContext: window.isSecureContext
    };
  });
  
  debug(`WebAuthn browser info: ${JSON.stringify(webAuthnInfo)}`);
  
  // Vérifier l'état de l'authentificateur virtuel
  try {
    const authenticatorInfo = await client.send('WebAuthn.getCredentials', { authenticatorId });
    debug(`Virtual authenticator info: ${JSON.stringify({
      authenticatorId,
      credentialsCount: authenticatorInfo.credentials.length,
      credentials: authenticatorInfo.credentials.map(c => ({ credentialId: c.credentialId, isResidentCredential: c.isResidentCredential }))
    })}`);
  } catch (err) {
    debug(`⚠️ Could not get authenticator info: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  // Renseigner les champs requis
  debug('Filling registration form');
  await page.fill('#userName', TEST_USER.userName);
  await page.fill('#userDisplayName', TEST_USER.userDisplayName);
  // email optionnel
  const emailField = page.locator('#email');
  if (await emailField.count()) {
    await emailField.fill(TEST_USER.email);
    debug('Email field filled');
  }


  // Soumettre l'inscription (démarre WebAuthn)
  const registerButton = page.getByRole('button', { name: /s'inscrire|inscription|webAuthn/i });
  debug('Clicking register button');
  
  // Capturer tous les appels API d'enregistrement
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/auth/register')) {
      debug(`Register API response: ${JSON.stringify({
        status: response.status(),
        statusText: response.statusText(),
        url: response.url()
      })}`);
    }
  });
  
  // Capturer aussi les requêtes pour voir ce qui est envoyé
  page.on('request', async (request) => {
    if (request.url().includes('/api/v1/auth/register')) {
      let postData = '';
      try {
        postData = await request.postData() || '';
      } catch (e) {}
      debug(`Register API request: ${JSON.stringify({
        method: request.method(),
        url: request.url(),
        postData: postData
      })}`);
    }
  });
  
  // Capturer les erreurs JavaScript dans la page
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      debug(`Console error: ${msg.text()}`);
    }
  });
  
  // Capturer les erreurs de page
  page.on('pageerror', (error) => {
    debug(`Page error: ${error.message}`);
  });
  
  await registerButton.click();

  // Attendre succès ou redirection avec plus de logs
  debug('Waiting for registration to complete...');
  await page.waitForTimeout(3000);
  debug(`After registration - URL: ${page.url()}`);
  
  // Vérifier s'il y a eu d'autres appels API
  debug('Checking for additional API calls...');
  
  // Vérifier que le credential a été créé dans l'authentificateur virtuel
  try {
    const credentials = await client.send('WebAuthn.getCredentials', { authenticatorId });
    debug(`Credentials after registration: ${credentials.credentials.length}`);
    if (credentials.credentials.length > 0) {
      debug('✅ WebAuthn credential created successfully');
    } else {
      debug('⚠️ No credentials found after registration');
    }
  } catch (err) {
    debug(`⚠️ Could not check credentials: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  // Vérifier que l'enregistrement/login a réussi
  // soit succès visible, soit redirection automatique vers dashboard
  const finalUrl = page.url();
  const isStillOnRegister = finalUrl.includes('/auth/register');
  
  if (isStillOnRegister) {
    debug('Still on register page, trying dashboard fallback');
    // tentative de fallback: aller au dashboard pour déclencher la redirection post-inscription si déjà validée côté API
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    const dashboardUrl = page.url();
    debug(`After dashboard fallback - URL: ${dashboardUrl}`);
    
    // Si toujours sur register ou login après fallback, c'est un échec
    if (dashboardUrl.includes('/auth/register') || dashboardUrl.includes('/auth/login')) {
      throw new Error('Registration failed - still on auth page after dashboard fallback');
    }
  } else {
    debug(`Registration successful, redirected to: ${finalUrl}`);
  }
  
  // Vérifier que la session est bien sauvegardée (cookies présents)
  const cookies = await page.context().cookies();
  if (cookies.length === 0) {
    throw new Error('Registration failed - no cookies found after registration');
  }
  debug(`✅ Session cookies found: ${cookies.length} cookie(s)`);
}

export default async function globalSetup() {
  debug('Starting global setup...');
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      args: [
        '--unsafely-treat-insecure-origin-as-secure=http://localhost:5173,http://localhost:8787',
        '--allow-insecure-localhost'
      ]
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const { client, authenticatorId } = await setupWebAuthn(page);
    await enrollOrLogin(page, client, authenticatorId);

    // Ensure ./.auth exists before saving storage state
    try {
      fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    } catch {}
    await context.storageState({ path: STORAGE_STATE_PATH });
    // Debug: list cookies saved in storage
    try {
      const cookies = await context.cookies();
      debug(`Cookies saved: ${JSON.stringify(cookies.map(c => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure })))}`);
    } catch {}
    
    // Si on arrive ici, c'est un succès - on peut nettoyer le buffer
    clearDebugBuffer();
    await browser.close();
  } catch (err) {
    // En cas d'erreur, afficher le buffer de debug avant de relancer l'erreur
    displayDebugOnFailure();
    if (browser) await browser.close();
    throw err;
  }
}


