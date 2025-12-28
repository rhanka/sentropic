import { test, expect } from '@playwright/test';

import { debug, setupDebugBuffer } from '../helpers/debug';

// Setup debug buffer to display on test failure
setupDebugBuffer();

// Ces flows dépendent de l'IA + jobs async; ça peut être lent.
test.setTimeout(8 * 60_000);

test.describe.serial('Génération IA', () => {
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
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');

    // Cliquer sur le bouton Ajouter
    await page.getByRole('button', { name: 'Ajouter' }).click();
    await page.waitForURL('/organisations/new', { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');

    // Remplir le nom de l'entreprise (BRP - déjà modifié par l'utilisateur)
    const titleEl = page.locator('h1').first();
    await expect(titleEl).toBeVisible();
    await titleEl.click();
    await page.keyboard.type('BRP (Bombardier)');
    await page.keyboard.press('Enter');
    
    // Attendre que la valeur soit propagée (réactivité Svelte)
    await page.waitForTimeout(500);
    
    // Utiliser le title pour cibler le bouton IA
    const aiButton = page.locator('button[title="Enrichir automatiquement avec l\'IA"]');
    await expect(aiButton).toBeEnabled({ timeout: 30_000 });

    const enrichResPromise = page.waitForResponse((res) => {
      const req = res.request();
      return req.method() === 'POST' && /\/api\/v1\/organizations\/[^/]+\/enrich$/.test(res.url());
    }, { timeout: 30_000 });

    await aiButton.click();
    const enrichRes = await enrichResPromise;
    const enrichJson = await enrichRes.json().catch(() => null);
    const enrichJobId = String((enrichJson as any)?.jobId ?? '').trim();
    if (!enrichJobId) throw new Error(`Réponse enrich organization sans jobId: ${JSON.stringify(enrichJson)}`);
    
    // Vérifier la redirection vers /organisations
    await page.waitForURL('/organisations', { timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
    
    debug(`Enrich jobId: ${enrichJobId} — attente fin du job...`);
    await waitForJobTerminal(page, enrichJobId, { timeoutMs: 6 * 60_000, intervalMs: 1000 });

    // La liste /organisations est alimentée par API + potentiellement SSE; après job terminal on force un refresh.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Attendre une carte BRP "terminée" (footer: "Cliquez pour voir les détails")
    const organizationCard = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasText: 'Cliquez pour voir les détails' }).first();
    await expect(organizationCard).toBeVisible({ timeout: 60_000 });
    
    // Cliquer sur la carte pour voir les détails
    await organizationCard.click();
    await page.waitForURL(/\/organisations\/[a-zA-Z0-9-]+/, { timeout: 30_000 });
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
    await page.waitForURL('/home', { timeout: 30_000 });
    debug(`Après clic - URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /home chargée');
    
    // Vérifier à nouveau la session
    const urlAfterHome = page.url();
    debug(`URL après chargement /home: ${urlAfterHome}`);
    if (urlAfterHome.includes('/auth/login')) {
      debug('ERROR: Session révoquée après navigation vers /home');
      throw new Error('Session révoquée - utilisateur non authentifié');
    }
    
    // Attendre que les organisations soient chargées (le select n'est visible que quand isLoading = false)
    debug('Recherche de la textarea...');
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    debug('Textarea trouvée, remplissage...');
    await textarea.fill('Génère 3 cas d\'usage pour l\'extension de l\'usine de Boucherville');
    debug('Textarea remplie');
    
    // Sélectionner l'organisation contenant Delpharm
    // Le select n'est visible que quand isLoading = false, donc attendre qu'il soit visible
    debug('Recherche du select organisation...');
    // Note: on the /home page the "label" is a <span> inside a <label> without for/id,
    // so Playwright getByLabel() is not reliable here. Target the select inside that label.
    const organizationSelect = page.locator('label:has-text("Organisation (optionnel)") select');
    await expect(organizationSelect).toBeVisible({ timeout: 15000 }); // CI can be slower when loading organizations
    debug('Select trouvé');
    
    // Afficher toutes les options disponibles pour debug
    const allOptions = await organizationSelect.locator('option').all();
    debug(`Nombre d'options trouvées: ${allOptions.length}`);
    for (let i = 0; i < allOptions.length; i++) {
      const optionText = await allOptions[i].textContent();
      const optionValue = await allOptions[i].getAttribute('value');
      debug(`Option ${i}: text="${optionText}", value="${optionValue}"`);
    }
    
    // Trouver l'option contenant Delpharm
    debug('Recherche de l\'option Delpharm...');
    const orgOptionCount = await organizationSelect.locator('option').filter({ hasText: 'Delpharm' }).count();
    debug(`Nombre d'options contenant "Delpharm": ${orgOptionCount}`);
    
    if (orgOptionCount === 0) {
      debug('ERROR: Aucune option contenant "Delpharm" trouvée');
      const allOptionsText = await organizationSelect.locator('option').allTextContents();
      debug(`ERROR: Options disponibles: ${JSON.stringify(allOptionsText)}`);
      throw new Error('Entreprise Delpharm non trouvée dans la liste');
    }
    
    const orgOption = organizationSelect.locator('option').filter({ hasText: 'Delpharm' }).first();
    const optionValue = await orgOption.getAttribute('value');
    debug(`Option Delpharm trouvée, value: ${optionValue}`);
    if (optionValue) {
      await organizationSelect.selectOption(optionValue);
      debug('Organisation Delpharm sélectionnée');
    } else {
      debug('ERROR: Option Delpharm trouvée mais pas de valeur');
      throw new Error('Option Delpharm trouvée mais sans valeur');
    }
    
    // Cliquer sur "Générer vos cas d'usage"
    debug('Recherche du bouton "Générer vos cas d\'usage"...');
    const generateButton = page.getByRole('button', { name: 'Générer vos cas d\'usage' });
    await expect(generateButton).toBeVisible({ timeout: 30_000 });

    const generateResPromise = page.waitForResponse((res) => {
      const req = res.request();
      return req.method() === 'POST' && res.url().includes('/api/v1/use-cases/generate');
    }, { timeout: 60_000 });

    debug('Bouton trouvé, clic...');
    await generateButton.click();
    debug('Bouton cliqué, attente redirection...');

    // Capturer le jobId + folderId depuis l'API (déterministe)
    const generateRes = await generateResPromise;
    const genJson = await generateRes.json().catch(() => null);
    const genJobId = String((genJson as any)?.jobId ?? '').trim();
    const folderId = String((genJson as any)?.created_folder_id ?? '').trim();
    debug(`Réponse /use-cases/generate: jobId=${genJobId} folderId=${folderId}`);
    if (!genJobId || !folderId) throw new Error(`Réponse generate invalide: ${JSON.stringify(genJson)}`);
    
    // Vérifier la redirection vers /dossiers (comportement après génération avec nouveau dossier)
    debug('Attente redirection vers /dossiers...');
    await page.waitForURL('/dossiers', { timeout: 60_000 });
    debug(`Redirection réussie vers /dossiers, URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /dossiers chargée');

    // Attendre que la queue confirme la fin du job, puis attendre qu'au moins un cas d'usage soit terminé (API).
    debug(`Attente fin job usecase_list: ${genJobId}`);
    await waitForJobTerminal(page, genJobId, { timeoutMs: 6 * 60_000, intervalMs: 1000 });
    debug(`Job ${genJobId} terminal, attente d'au moins un use case terminé (folder=${folderId})...`);
    await waitForAnyUseCaseCompleted(page, folderId, 6 * 60_000);

    // Navigation déterministe vers le listing des cas d'usage du dossier.
    await page.goto(`/cas-usage?folder=${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier le titre "Cas d'usage"
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Attendre une carte terminée et y naviguer
    const firstUseCaseCard = page.locator('.grid.gap-4 > article').filter({ hasText: 'Cliquez pour voir les détails' }).first();
    await expect(firstUseCaseCard).toBeVisible({ timeout: 60_000 });
    await firstUseCaseCard.click();
    await page.waitForURL(/\/cas-usage\/[a-zA-Z0-9-]+/, { timeout: 30_000 });
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
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    const sendChatAndWaitApi = async (message: string) => {
      await composer.fill(message);
      await Promise.all([
        page.waitForResponse((res) => {
          const req = res.request();
          return req.method() === 'POST' && res.url().includes('/api/v1/chat/messages');
        }, { timeout: 30_000 }),
        composer.press('Enter')
      ]);
    };
    
    const message1 = 'Quel est le nom de ce cas d\'usage ?';
    await sendChatAndWaitApi(message1);
    
    const userMessage1 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 5000 });
    
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse1 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse1).toBeVisible({ timeout: 90_000 });
    
    // Test 2: update_usecase_field
    debug('Test Chat: update_usecase_field');
    
    const message2 = 'Ajoute "Test E2E" au début de la description';
    await sendChatAndWaitApi(message2);
    
    const userMessage2 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message2 }).first();
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
    
    const userMessage3 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message3 }).first();
    await expect(userMessage3).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (avec tool call web_extract)
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse3 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse3).toBeVisible({ timeout: 90_000 });
  });
});
