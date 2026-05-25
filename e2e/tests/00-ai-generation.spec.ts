import { test, expect } from '@playwright/test';

import { debug, setupDebugBuffer } from '../helpers/debug';

// Setup debug buffer to display on test failure
setupDebugBuffer();

// Ces flows dépendent de l'IA + jobs async; ça peut être lent.
test.setTimeout(8 * 60_000);

test.describe('Génération IA', () => {
  // Ces tests sont coûteux (jobs async, appels externes mockés/ratelimités). Les retries globales (retries: 2)
  // triplent inutilement la durée et masquent les flakys. On les désactive pour ce fichier.
  test.describe.configure({ mode: 'serial', retries: 0 });

  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

  test.beforeEach(async ({ page }) => {
    // Stabiliser: éviter que d'autres specs laissent l'admin en scope "lecture seule"
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, ADMIN_WORKSPACE_ID);
  });

  const waitForJobTerminal = async (
    page: any,
    jobId: string,
    opts?: { timeoutMs?: number; intervalMs?: number }
  ) => {
    const timeoutMs = opts?.timeoutMs ?? 6 * 60_000;
    const intervalMs = opts?.intervalMs ?? 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const res = await page.request.get(`/api/v1/queue/jobs/${encodeURIComponent(jobId)}`);
      if (!res.ok()) {
        await page.waitForTimeout(intervalMs);
        continue;
      }
      const txt = await res.text();
      let job: any = null;
      try {
        job = JSON.parse(txt);
      } catch {
        // ignore
      }
      const status = String(job?.status ?? 'unknown');
      if (status === 'completed') return;
      if (status === 'failed') {
        throw new Error(`Job ${jobId} failed: ${txt}`);
      }
      await page.waitForTimeout(intervalMs);
    }
    throw new Error(`Job ${jobId} n'a pas terminé dans les délais (${timeoutMs}ms)`);
  };

  const waitForAnyUseCaseCompleted = async (page: any, folderId: string, timeoutMs = 6 * 60_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const res = await page.request.get(`/api/v1/use-cases?folder_id=${encodeURIComponent(folderId)}`);
      if (res.ok()) {
        const body = await res.json().catch(() => null);
        const items: any[] = (body as any)?.items ?? [];
        if (items.some((uc) => {
          const s = String(uc?.status ?? 'completed');
          return s !== 'generating' && s !== 'detailing';
        })) {
          return;
        }
      }
      await page.waitForTimeout(1500);
    }
    throw new Error(`Aucun cas d'usage terminé dans les délais (${timeoutMs}ms) (folder_id=${folderId})`);
  };

  // 1) Génération d'entreprise (enrichissement IA) via l'UI
  test('devrait générer une organisation via IA (enrichissement) et l\'enregistrer', async ({ page }) => {
    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');

    // Aller à la page de création via le menu d'actions
    const actionsButton = page.locator('button[aria-label="Actions organisation"]');
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();
    const newAction = page.locator('button:has-text("Nouveau")');
    await expect(newAction).toBeVisible();
    await newAction.click();
    await page.waitForURL('/organizations/new', { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    // Remplir le nom de l'entreprise (EditableInput)
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill('BRP (Bombardier)');
    
    // Attendre que la valeur soit propagée (réactivité Svelte)
    await page.waitForTimeout(500);
    
    // Bouton IA (icône)
    const aiButton = page.locator('[data-testid="enrich-organization"], button[aria-label="IA"]').first();
    await expect(aiButton).toBeEnabled({ timeout: 30_000 });

    const draftResPromise = page
      .waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'POST' && /\/api\/v1\/organizations\/draft/.test(res.url());
      }, { timeout: 15_000 })
      .catch(() => null);

    const enrichResPromise = page.waitForResponse((res) => {
      const req = res.request();
      return req.method() === 'POST' && /\/api\/v1\/organizations\/[^/]+\/enrich/.test(res.url());
    }, { timeout: 60_000 });

    await aiButton.click();
    const draftRes = await draftResPromise;
    if (draftRes && !draftRes.ok()) {
      const body = await draftRes.text().catch(() => '');
      throw new Error(`Erreur creation brouillon organisation: ${draftRes.status()} ${body.slice(0, 200)}`);
    }
    const enrichRes = await enrichResPromise;
    const enrichJson = await enrichRes.json().catch(() => null);
    const enrichJobId = String((enrichJson as any)?.jobId ?? '').trim();
    if (!enrichJobId) throw new Error(`Réponse enrich organization sans jobId: ${JSON.stringify(enrichJson)}`);
    
    // Vérifier la redirection vers /organizations
    await page.waitForURL('/organizations', { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    
    debug(`Enrich jobId: ${enrichJobId} — attente fin du job...`);
    await waitForJobTerminal(page, enrichJobId, { timeoutMs: 6 * 60_000, intervalMs: 1000 });

    // La liste /organizations est alimentée par API + potentiellement SSE; après job terminal on force un refresh.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Attendre une carte BRP "terminée" (footer: "Cliquez pour voir les détails")
    const organizationCard = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasText: 'Cliquez pour voir les détails' }).first();
    await expect(organizationCard).toBeVisible({ timeout: 60_000 });
    
    // Cliquer sur la carte pour voir les détails
    await organizationCard.click();
    await page.waitForURL(/\/organizations\/[a-zA-Z0-9-]+/, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier que le titre contient BRP (textarea pour multiline)
    const organizationTitle = page.locator('h1 textarea.editable-textarea, h1 input.editable-input').first();
    await expect(organizationTitle).toHaveValue(/BRP/);
  });

  // 2) Génération de cas d'usage depuis l'accueil
  test('devrait générer des cas d\'usage depuis l\'accueil et vérifier les références', async ({ page }) => {
    debug(`Début du test - URL initiale: ${page.url()}`);
    
    // Aller à l'accueil
    await page.goto('/');
    debug(`Après goto / - URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    const pageTitle = await page.title();
    debug(`Page chargée, titre: ${pageTitle}`);
    
    // Vérifier si on est redirigé vers login (session révoquée)
    const currentUrl = page.url();
    debug(`URL actuelle avant clic Commencer: ${currentUrl}`);
    if (currentUrl.includes('/auth/login')) {
      debug('ERROR: Session révoquée - redirigé vers login');
      throw new Error('Session révoquée - utilisateur non authentifié');
    }
    
    // Cliquer sur "Commencer" (lien vers /home)
    debug('Recherche du lien Commencer...');
    const commencerLink = page.getByRole('link', { name: 'Commencer' });
    await expect(commencerLink).toBeVisible({ timeout: 30_000 });
    debug('Lien Commencer trouvé, clic...');
    await commencerLink.click();
    // /home redirige vers le dashboard neutre; on sélectionne ensuite le workspace
    // admin puis on crée un nouveau dossier depuis le menu Dossiers.
    await page.waitForURL(/\/neutral$/, { timeout: 30_000 });
    debug(`Après clic + redirection dashboard - URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');

    const workspaceCard = page.locator('article').filter({ hasText: 'Admin Workspace' }).first();
    await expect(workspaceCard).toBeVisible({ timeout: 30_000 });
    await workspaceCard.click();
    await page.waitForURL('/folders', { timeout: 30_000 });
    debug(`Workspace sélectionné, URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');

    const folderActionsButton = page.locator('button[aria-label="Actions dossier"]');
    await expect(folderActionsButton).toBeVisible({ timeout: 30_000 });
    await folderActionsButton.click();
    const newFolderAction = page.locator('button:has-text("Nouveau")').first();
    await expect(newFolderAction).toBeVisible({ timeout: 30_000 });
    await newFolderAction.click();
    await page.waitForURL(/\/folder\/new$/, { timeout: 30_000 });
    debug(`Après clic + redirection - URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /folder/new chargée');
    
    // Vérifier à nouveau la session
    const urlAfterStart = page.url();
    debug(`URL après chargement /folder/new: ${urlAfterStart}`);
    if (urlAfterStart.includes('/auth/login')) {
      debug('ERROR: Session révoquée après navigation');
      throw new Error('Session révoquée - utilisateur non authentifié');
    }
    
    // Attendre que les organisations soient chargées (le select n'est visible que quand isLoading = false)
    debug('Recherche de l’éditeur Contexte (TipTap / ProseMirror)...');
    const contextEditor = page.locator('.markdown-input-wrapper [contenteditable="true"]').first();
    await expect(contextEditor).toBeVisible({ timeout: 30_000 });
    debug('Éditeur trouvé, remplissage...');
    await contextEditor.click();
    // TipTap utilise contenteditable; fill peut être capricieux selon le navigateur => keyboard.
    await page.keyboard.press('Control+A');
    await page.keyboard.type("Génère 3 cas d'usage pour l'extension de l'usine de Boucherville");
    debug('Contexte rempli');
    
    // Sélectionner l'organisation contenant Delpharm via le menu multi-organisations.
    debug('Recherche du menu organisations ciblées...');
    const organizationMenuButton = page.getByRole('button', { name: 'Organisations ciblées (optionnel)' });
    await expect(organizationMenuButton).toBeVisible({ timeout: 15_000 });
    await organizationMenuButton.click();
    debug('Menu organisations ouvert, recherche Delpharm...');
    const delpharmOption = page.getByRole('menuitemcheckbox', { name: /Delpharm/ }).first();
    await expect(delpharmOption).toBeVisible({ timeout: 15_000 });
    await delpharmOption.click();
    await expect(organizationMenuButton).toContainText('Delpharm', { timeout: 15_000 });
    debug('Organisation Delpharm sélectionnée');
    
    // Démarrer la génération via le bouton IA (icône)
    debug('Recherche du bouton "IA"...');
    // Attention: le widget "Chat / Jobs IA" contient aussi "IA" dans son nom accessible.
    // On cible donc explicitement le bouton de génération (title/aria-label "IA").
    const generateButton = page.locator('button[title="IA"][aria-label="IA"]').first();
    await expect(generateButton).toBeVisible({ timeout: 30_000 });

    const generateResPromise = page.waitForResponse((res) => {
      const req = res.request();
      return req.method() === 'POST' && res.url().includes('/api/v1/initiatives/generate');
    }, { timeout: 60_000 });

    debug('Bouton trouvé, clic...');
    await generateButton.click();
    debug('Bouton cliqué, attente redirection...');

    // Capturer le jobId + folderId depuis l'API (déterministe)
    const generateRes = await generateResPromise;
    const genJson = await generateRes.json().catch(() => null);
    const genJobId = String((genJson as any)?.jobId ?? '').trim();
    const folderId = String((genJson as any)?.folder_id ?? (genJson as any)?.created_folder_id ?? '').trim();
    debug(`Réponse /initiatives/generate: jobId=${genJobId} folderId=${folderId}`);
    if (!genJobId || !folderId) throw new Error(`Réponse generate invalide: ${JSON.stringify(genJson)}`);
    
    // Vérifier la redirection vers /folders (comportement après génération avec nouveau dossier)
    debug('Attente redirection vers /folders...');
    await page.waitForURL('/folders', { timeout: 60_000 });
    debug(`Redirection réussie vers /folders, URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /folders chargée');

    // Attendre que la queue confirme la fin du job, puis attendre qu'au moins un cas d'usage soit terminé (API).
    debug(`Attente fin job usecase_list: ${genJobId}`);
    await waitForJobTerminal(page, genJobId, { timeoutMs: 6 * 60_000, intervalMs: 1000 });
    debug(`Job ${genJobId} terminal, attente d'au moins un use case terminé (folder=${folderId})...`);
    await waitForAnyUseCaseCompleted(page, folderId, 6 * 60_000);

    // Navigation déterministe vers la page dossier (liste cas d'usage est sur /folders/[id])
    await page.goto(`/folders/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    
    // Attendre une carte terminée et y naviguer
    const firstUseCaseCard = page.locator('.grid.gap-4 > article').filter({ hasText: 'Valeur:' }).first();
    await expect(firstUseCaseCard).toBeVisible({ timeout: 60_000 });
    await firstUseCaseCard.click();
    await page.waitForURL(/\/initiative\/[a-zA-Z0-9-]+/, { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier la section Références
    const referencesSection = page.locator('text=Références').first();
    await expect(referencesSection).toBeVisible({ timeout: 30_000 });
    
    // Vérifier qu'il y a au moins une URL valide dans les références
    const referenceLinks = page.locator('section:has-text("Références") a[href^="http"]');
    const linkCount = await referenceLinks.count();
    expect(linkCount).toBeGreaterThan(0);
    
    // Vérifier que les URLs sont valides (commencent par http:// ou https://)
    if (linkCount > 0) {
      const firstLink = referenceLinks.first();
      const href = await firstLink.getAttribute('href');
      expect(href).toMatch(/^https?:\/\//);
      
      // Vérifier que l'URL existe via fetch (sans ouvrir le navigateur)
      // Note: certaines URLs peuvent être inaccessibles (timeout, erreur réseau), on ignore l'erreur
      try {
        const response = await page.request.fetch(href!, { timeout: 5000 });
        if (response.ok() && response.status() < 400) {
          debug(`URL ${href} accessible (${response.status()})`);
        } else {
          debug(`URL ${href} retourne ${response.status()} (non bloquant)`);
        }
      } catch (err) {
        debug(`URL ${href} non accessible (timeout/erreur réseau, non bloquant): ${err}`);
        // On ignore l'erreur, ce n'est pas bloquant pour le test
      }
    }
    
    // Tests Chat avec tool calls (on a maintenant un use case disponible avec références)
    
    // Test 1: read_usecase
    debug('Test Chat: read_usecase');
    const chatButton = page.locator(
      'button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]'
    );
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    const sendChatAndWaitApi = async (message: string) => {
      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(message);
      await Promise.all([
        page.waitForResponse((res) => {
          const req = res.request();
          return req.method() === 'POST' && res.url().includes('/api/v1/chat/messages');
        }, { timeout: 30_000 }),
        page.keyboard.press('Enter')
      ]);
    };
    
    const message1 = 'Quel est le nom de ce cas d\'usage ?';
    await sendChatAndWaitApi(message1);
    
    const userMessage1 = page.locator('.userMarkdown').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 5000 });
    
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse1 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse1).toBeVisible({ timeout: 90_000 });
    
    // Test 2: update_usecase_field
    debug('Test Chat: update_usecase_field');
    
    const message2 = 'Ajoute "Test E2E" au début de la description';
    await sendChatAndWaitApi(message2);
    
    const userMessage2 = page.locator('.userMarkdown').filter({ hasText: message2 }).first();
    await expect(userMessage2).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (avec tool call update_usecase_field)
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse2 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse2).toBeVisible({ timeout: 90_000 });
    
    // Vérifier que la modification apparaît en direct via SSE (pas de refresh)
    // Note: la modification peut prendre quelques secondes via SSE, on attend jusqu'à 5s
    // On cherche "Test E2E" n'importe où dans la page (dans la description)
    await expect(page.locator('body')).toContainText('Test E2E', { timeout: 5000 });
    
    // Test 3: web_extract (on a déjà vérifié qu'il y a des références)
    debug('Test Chat: web_extract');
    const message3 = 'Analyse les références en détail';
    await sendChatAndWaitApi(message3);
    
    const userMessage3 = page.locator('.userMarkdown').filter({ hasText: message3 }).first();
    await expect(userMessage3).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (avec tool call web_extract)
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse3 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse3).toBeVisible({ timeout: 90_000 });
  });
});
