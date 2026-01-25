import { chromium, request, type Browser, type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { debug, displayDebugOnFailure, clearDebugBuffer } from './helpers/debug-global-setup';
import { waitForVerificationCode, waitForMagicLinkToken, deleteAllEmails, getAllEmails } from './helpers/maildev';

const STORAGE_STATE_PATH = './.auth/state.json'; // admin (default for most tests)
const STORAGE_STATE_USER_A = './.auth/user-a.json';
const STORAGE_STATE_USER_B = './.auth/user-b.json';
const STORAGE_STATE_VICTIM = './.auth/user-victim.json';
const BASE_URL = process.env.UI_BASE_URL || 'http://localhost:5173';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

type TestUser = {
  email: string;
  displayName: string;
};

const ADMIN_USER: TestUser = {
  email: process.env.ADMIN_EMAIL || 'e2e-admin@example.com',
  displayName: 'E2E Admin',
};

const USER_A: TestUser = {
  email: 'e2e-user-a@example.com',
  displayName: 'E2E User A',
};

const USER_B: TestUser = {
  email: 'e2e-user-b@example.com',
  displayName: 'E2E User B',
};

const USER_VICTIM: TestUser = {
  email: 'e2e-user-victim@example.com',
  displayName: 'E2E Victim',
};

async function assertSeededUsersExist(storageStatePath: string, usersToCheck: TestUser[]) {
  const api = await request.newContext({ baseURL: API_BASE_URL, storageState: storageStatePath });
  try {
    const res = await api.get('/api/v1/admin/users');
    if (!res.ok()) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /api/v1/admin/users failed: ${res.status()} ${res.statusText()} ${body.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => null);
    const items: Array<{ email?: string; emailVerified?: boolean }> = data?.items ?? [];
    const byEmail = new Map(items.map((u) => [String(u.email || ''), u]));
    const missing = usersToCheck.filter((u) => !byEmail.has(u.email)).map((u) => u.email);
    if (missing.length > 0) {
      throw new Error(`Seed utilisateurs manquant(s): ${missing.join(', ')}`);
    }
    const notVerified = usersToCheck
      .filter((u) => byEmail.has(u.email) && !byEmail.get(u.email)?.emailVerified)
      .map((u) => u.email);
    if (notVerified.length > 0) {
      throw new Error(`Seed utilisateurs non vérifiés (emailVerified=false): ${notVerified.join(', ')}`);
    }
  } finally {
    await api.dispose();
  }
}

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

async function enrollOrLogin(page: Page, client: any, authenticatorId: string, user: TestUser) {
  // Toujours faire l'enrôlement (pas de détection de session existante)
  debug(`Proceeding with enrollment for ${user.email}`);
  
  // Nettoyer les emails précédents dans Maildev
  try {
    await deleteAllEmails();
    debug('Cleared previous emails from Maildev');
  } catch (err) {
    debug(`⚠️ Could not clear emails: ${err instanceof Error ? err.message : String(err)}`);
  }
  
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
  
  // Enrôlement WebAuthn via UI avec workflow email verification
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
  
  // Étape 1: Entrer l'email et demander le code
  debug('Step 1: Requesting verification code');
  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeVisible({ timeout: 5000 });
  await emailField.fill(user.email);
  debug(`Email filled: ${user.email}`);
  
  const requestCodeButton = page.getByRole('button', { name: /demander|envoyer|code/i });
  await expect(requestCodeButton).toBeVisible({ timeout: 5000 });
  
  // Attendre que le bouton soit cliquable
  await requestCodeButton.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  
  // Intercepter les requêtes API pour vérifier que l'email est envoyé
  let emailRequestSent = false;
  let emailRequestResponse: any = null;
  
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/register/verify-email') && request.method() === 'POST') {
      emailRequestSent = true;
      debug(`✅ Email verification request sent to: ${request.url()}`);
    }
  });
  
  page.on('response', async (response) => {
    if (response.url().includes('/api/v1/auth/register/verify-email') && response.request().method() === 'POST') {
      emailRequestResponse = {
        status: response.status(),
        statusText: response.statusText(),
        url: response.url()
      };
      debug(`✅ Email verification response: ${response.status()} ${response.statusText()}`);
      try {
        const body = await response.text();
        debug(`Response body: ${body.substring(0, 200)}`);
      } catch (e) {
        debug(`Could not read response body: ${e}`);
      }
    }
  });
  
  await requestCodeButton.click();
  debug('Request code button clicked');
  
  // Attendre que la requête soit envoyée et la réponse reçue
  await page.waitForTimeout(3000);
  
  if (!emailRequestSent) {
    debug('⚠️ Warning: Email verification request may not have been sent');
  } else if (emailRequestResponse) {
    debug(`✅ Email verification request completed: ${emailRequestResponse.status} ${emailRequestResponse.statusText}`);
    if (emailRequestResponse.status !== 200 && emailRequestResponse.status !== 201) {
      debug(`⚠️ Warning: Email verification request returned status ${emailRequestResponse.status}`);
    }
  }
  
  // Attendre que le formulaire passe à l'étape "code" (les champs de code devraient apparaître)
  try {
    await page.waitForSelector('#code-0', { timeout: 5000 });
    debug('✅ Code input fields are visible');
  } catch (e) {
    debug(`⚠️ Code input fields not visible yet: ${e}`);
  }
  
  await page.waitForTimeout(1000);
  
  // Étape 2: Récupérer le code depuis Maildev et l'entrer
  debug('Step 2: Waiting for verification code from Maildev');
  try {
    const verificationCode = await waitForVerificationCode(user.email, 60000); // Augmenter le timeout à 60s
    debug(`Verification code received: ${verificationCode}`);
    
    // Entrer le code dans les champs individuels
    debug('Step 3: Entering verification code');
    const codeDigits = verificationCode.split('');
    for (let i = 0; i < 6; i++) {
      const codeInput = page.locator(`#code-${i}`);
      await expect(codeInput).toBeVisible({ timeout: 5000 });
      await codeInput.fill(codeDigits[i]);
    }
    debug('Verification code entered');
    
    // Le code devrait se soumettre automatiquement après avoir rempli tous les champs
    // Sinon, attendre un peu pour la soumission automatique
    await page.waitForTimeout(2000);
  } catch (err) {
    debug(`❌ Failed to get verification code: ${err instanceof Error ? err.message : String(err)}`);
    // Essayer de voir ce qui s'est passé
    try {
      const allEmails = await getAllEmails();
      debug(`Available emails in Maildev: ${allEmails.length}`);
      allEmails.forEach((email, idx) => {
        debug(`Email ${idx + 1}: To: ${email.to.map(t => t.address).join(', ')}, Subject: ${email.subject}`);
      });
    } catch (mailErr) {
      debug(`Could not check Maildev: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`);
    }
    throw err;
  }
  
  // Attendre que le formulaire passe à l'étape "webauthn"
  debug('Step 4: Waiting for WebAuthn enrollment step');
  const webauthnButton = page.getByRole('button', { name: /enregistrer|appareil|webauthn/i });
  await expect(webauthnButton).toBeVisible({ timeout: 10000 });
  debug('WebAuthn enrollment step reached');
  
  // Étape 3: Enregistrer l'appareil WebAuthn
  debug('Step 5: Starting WebAuthn enrollment');
  await webauthnButton.click();
  debug('WebAuthn enrollment button clicked');
  
  // Attendre que le credential soit créé
  await page.waitForTimeout(3000);
  
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
  
  // Attendre la redirection ou le message de succès
  debug('Waiting for registration completion...');
  await page.waitForTimeout(3000);
  debug(`After registration - URL: ${page.url()}`);
  
  // Vérifier que l'enregistrement a réussi
  // soit succès visible, soit redirection automatique vers /home
  const finalUrl = page.url();
  const isStillOnRegister = finalUrl.includes('/auth/register');
  
  if (isStillOnRegister) {
    debug('Still on register page, waiting for success step/redirect');
    try {
      await page.waitForSelector('text=Inscription réussie ! Redirection...', { timeout: 10000 });
      debug('✅ Success message displayed');
    } catch (e) {
      debug(`⚠️ Success message not detected: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      await page.waitForURL((url) => url.toString().includes('/home'), { timeout: 15000 });
      debug(`Redirected automatically to: ${page.url()}`);
    } catch (e) {
      debug(`⚠️ Auto redirect to /home did not occur: ${e instanceof Error ? e.message : String(e)}`);
      debug('Navigating manually to /home');
      await page.goto(`${BASE_URL}/home`);
      await page.waitForLoadState('networkidle');
    }
  } else {
    debug(`Registration successful, redirected to: ${finalUrl}`);
    if (!finalUrl.includes('/home')) {
      debug('Navigating to /home to ensure consistent post-registration state');
      await page.goto(`${BASE_URL}/home`);
      await page.waitForLoadState('networkidle');
    }
  }
  
  // Vérifier que la session est bien sauvegardée (cookies présents)
  const cookies = await page.context().cookies();
  if (cookies.length === 0) {
    throw new Error('Registration failed - no cookies found after registration');
  }
  debug(`✅ Session cookies found: ${cookies.length} cookie(s)`);
  cookies.forEach(cookie => {
    const info = `Cookie -> name: ${cookie.name}, value: ${cookie.value.slice(0, 20)}..., domain: ${cookie.domain}, secure: ${cookie.secure}, sameSite: ${cookie.sameSite}`;
    debug(info);
    console.log(info);
  });
  
  // Playwright drops secure cookies when browsing over HTTP during tests.
  // For E2E we run the stack with HTTP, so manually re-set the session cookie without the Secure flag.
  const sessionCookie = cookies.find(cookie => cookie.name === 'session');
  if (sessionCookie) {
    debug('Adjusting session cookie for HTTP testing environment');
    await page.context().addCookies([
      {
        name: 'session',
        value: sessionCookie.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: sessionCookie.expires,
      },
    ]);
    const updatedCookies = await page.context().cookies();
    updatedCookies.forEach(cookie => {
      const info = `Post-adjust cookie -> name: ${cookie.name}, value: ${cookie.value.slice(0, 20)}..., domain: ${cookie.domain}, secure: ${cookie.secure}, sameSite: ${cookie.sameSite}`;
      debug(info);
      console.log(info);
    });
  } else {
    debug('⚠️ Session cookie not found when adjusting cookie flags');
  }
  
  // Vérifier que la session est valide en navigant vers une page protégée
  debug('Step 6: Verifying session is valid...');
  await page.goto(`${BASE_URL}/entreprises`);
  // Attendre que la page soit chargée (domcontentloaded) au lieu de networkidle
  // car la connexion SSE empêche networkidle de se déclencher
  await page.waitForLoadState('domcontentloaded');
  // Attendre un élément spécifique de la page pour confirmer qu'elle est bien chargée
  try {
    await page.waitForSelector('h1', { timeout: 5000 });
  } catch (e) {
    // Si h1 n'est pas trouvé, vérifier si on est redirigé vers login
    const currentUrl = page.url();
    if (currentUrl.includes('/auth/login')) {
      throw new Error('Registration failed - session is not valid (redirected to login)');
    }
    // Sinon, on considère que la page est chargée même sans h1
    debug('⚠️ h1 not found but page loaded');
  }
  const protectedUrl = page.url();
  debug(`After protected page verification - URL: ${protectedUrl}`);
  
  // Si on est redirigé vers login, la session n'est pas valide
  if (protectedUrl.includes('/auth/login')) {
    throw new Error('Registration failed - session is not valid (redirected to login)');
  }
  
  debug('✅ Session verified - can access protected pages');
}

async function enrollAndSave(browser: Browser, user: TestUser, storagePath: string) {
  const context = await browser.newContext();
  const page = await context.newPage();

  const { client, authenticatorId } = await setupWebAuthn(page);
  await enrollOrLogin(page, client, authenticatorId, user);

  // Ensure ./.auth exists before saving storage state
  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  } catch {}

  await context.storageState({ path: storagePath });
  await context.close();
  debug(`✅ Storage state saved for ${user.email} -> ${storagePath}`);
}

async function magicLinkLoginAndSave(browser: Browser, user: TestUser, storagePath: string) {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Avoid mixing emails between accounts
  await deleteAllEmails();

  const api = await request.newContext({ baseURL: API_BASE_URL });
  try {
    const res = await api.post('/api/v1/auth/magic-link/request', { data: { email: user.email } });
    if (!res.ok()) {
      throw new Error(`POST /api/v1/auth/magic-link/request failed: ${res.status()} ${res.statusText()}`);
    }
  } finally {
    await api.dispose();
  }

  const token = await waitForMagicLinkToken(user.email, 60_000);
  // Do NOT rely on UI route /auth/magic-link/verify (can be flaky depending on client runtime).
  // Instead, verify via API to retrieve a sessionToken, then set the cookie manually.
  const apiVerify = await request.newContext({ baseURL: API_BASE_URL });
  try {
    const res = await apiVerify.post('/api/v1/auth/magic-link/verify', {
      data: { token },
      headers: { origin: BASE_URL },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /api/v1/auth/magic-link/verify failed: ${res.status()} ${res.statusText()} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { sessionToken?: string };
    if (!data.sessionToken) throw new Error(`Missing sessionToken in magic-link verify response for ${user.email}`);

    // Set cookie in browser context (HTTP E2E => secure=false)
    await context.addCookies([
      {
        name: 'session',
        value: data.sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  } finally {
    await apiVerify.dispose();
  }

  // Verify cookie works by loading a protected page
  await page.goto(`${BASE_URL}/entreprises`);
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('/auth/login')) {
    throw new Error(`Magic link session invalid for ${user.email} (redirected to /auth/login)`);
  }

  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  } catch {}
  await context.storageState({ path: storagePath });
  await context.close();
  debug(`✅ Storage state saved (magic link) for ${user.email} -> ${storagePath}`);
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
    // Auth strategy for E2E:
    // Use magic-link for ALL users (including admin) to avoid flaky WebAuthn enrollment.
    // Requirements:
    // - db-seed-test creates these users in DB
    // - users.emailVerified MUST be true (session validation requires it)
    // - admin user has role=admin_app
    await magicLinkLoginAndSave(browser, ADMIN_USER, STORAGE_STATE_PATH);
    await magicLinkLoginAndSave(browser, USER_A, STORAGE_STATE_USER_A);
    await magicLinkLoginAndSave(browser, USER_B, STORAGE_STATE_USER_B);
    await magicLinkLoginAndSave(browser, USER_VICTIM, STORAGE_STATE_VICTIM);

    // Fail-fast: verify that all required seed users exist and are verified.
    await assertSeededUsersExist(STORAGE_STATE_PATH, [ADMIN_USER, USER_A, USER_B, USER_VICTIM]);
    
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


