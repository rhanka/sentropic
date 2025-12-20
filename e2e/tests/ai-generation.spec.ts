import { test, expect } from '@playwright/test';

// These flows depend on AI + async background jobs; CI can be slower.
test.setTimeout(4 * 60_000);
import { debug, setupDebugBuffer } from '../helpers/debug';

// Setup debug buffer to display on test failure
setupDebugBuffer();

// Étendre le timeout global de ce fichier (génération IA peut être plus lente)
test.setTimeout(120_000); // 2 minutes pour la génération IA complète

test.describe('Génération IA', () => {
  // 1) Génération d'entreprise (enrichissement IA) via l'UI
  test('devrait générer une entreprise via IA (enrichissement) et l\'enregistrer', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('domcontentloaded');

    // Cliquer sur le bouton Ajouter
    await page.click('button:has-text("Ajouter")');
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
    await expect(aiButton).toBeEnabled({ timeout: 1000 });
    await aiButton.click();
    
    // Vérifier la redirection vers /entreprises
    await page.waitForURL('/entreprises', { timeout: 1000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Attendre la fin de l'enrichissement (le statut n'est plus "enriching")
    // D'abord vérifier qu'une carte BRP en enrichissement existe
    const companyCardEnriching = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasText: 'En cours…' }).first();
    await expect(companyCardEnriching).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'une carte BRP sans "En cours…" apparaisse (enrichissement terminé)
    // Utiliser une boucle pour vérifier toutes les 3 secondes jusqu'à 30 secondes (10 tentatives)
    let companyCard;
    let attempts = 0;
    const maxAttempts = 10; // 10 tentatives * 3 secondes = 30 sec max
    
    while (attempts < maxAttempts) {
      const availableCards = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasNotText: 'En cours…' });
      const count = await availableCards.count();
      
      if (count > 0) {
        companyCard = availableCards.first();
        break;
      }
      
      await page.waitForTimeout(3000); // Attendre 3 secondes avant de réessayer
      attempts++;
      await page.reload(); // Recharger pour voir les mises à jour de statut
      await page.waitForLoadState('domcontentloaded');
    }
    
    if (!companyCard) {
      throw new Error('L\'enrichissement de l\'entreprise BRP n\'a pas terminé dans les délais (30 secondes)');
    }
    
    // Cliquer sur la carte pour voir les détails
    await companyCard.click();
    await page.waitForURL(/\/entreprises\/[a-zA-Z0-9-]+/, { timeout: 2000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier que le titre contient BRP (textarea pour multiline)
    const companyTitle = page.locator('h1 textarea.editable-textarea, h1 input.editable-input').first();
    await expect(companyTitle).toHaveValue(/BRP/);
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
    await expect(commencerLink).toBeVisible({ timeout: 1000 });
    debug('Lien Commencer trouvé, clic...');
    await commencerLink.click();
    await page.waitForURL('/home', { timeout: 2000 });
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
    
    // Attendre que les entreprises soient chargées (le select n'est visible que quand isLoading = false)
    debug('Recherche de la textarea...');
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 1000 });
    debug('Textarea trouvée, remplissage...');
    await textarea.fill('Génère 3 cas d\'usage pour l\'extension de l\'usine de Boucherville');
    debug('Textarea remplie');
    
    // Sélectionner l'entreprise contenant Delpharm
    // Le select n'est visible que quand isLoading = false, donc attendre qu'il soit visible
    debug('Recherche du select entreprise...');
    // Note: on the /home page the "label" is a <span> inside a <label> without for/id,
    // so Playwright getByLabel() is not reliable here. Target the select inside that label.
    const companySelect = page.locator('label:has-text("Entreprise (optionnel)") select');
    await expect(companySelect).toBeVisible({ timeout: 15000 }); // CI can be slower when loading companies
    debug('Select trouvé');
    
    // Afficher toutes les options disponibles pour debug
    const allOptions = await companySelect.locator('option').all();
    debug(`Nombre d'options trouvées: ${allOptions.length}`);
    for (let i = 0; i < allOptions.length; i++) {
      const optionText = await allOptions[i].textContent();
      const optionValue = await allOptions[i].getAttribute('value');
      debug(`Option ${i}: text="${optionText}", value="${optionValue}"`);
    }
    
    // Trouver l'option contenant Delpharm
    debug('Recherche de l\'option Delpharm...');
    const companyOptionCount = await companySelect.locator('option').filter({ hasText: 'Delpharm' }).count();
    debug(`Nombre d'options contenant "Delpharm": ${companyOptionCount}`);
    
    if (companyOptionCount === 0) {
      debug('ERROR: Aucune option contenant "Delpharm" trouvée');
      const allOptionsText = await companySelect.locator('option').allTextContents();
      debug(`ERROR: Options disponibles: ${JSON.stringify(allOptionsText)}`);
      throw new Error('Entreprise Delpharm non trouvée dans la liste');
    }
    
    const companyOption = companySelect.locator('option').filter({ hasText: 'Delpharm' }).first();
    const optionValue = await companyOption.getAttribute('value');
    debug(`Option Delpharm trouvée, value: ${optionValue}`);
    if (optionValue) {
      await companySelect.selectOption(optionValue);
      debug('Entreprise Delpharm sélectionnée');
    } else {
      debug('ERROR: Option Delpharm trouvée mais pas de valeur');
      throw new Error('Option Delpharm trouvée mais sans valeur');
    }
    
    // Cliquer sur "Générer vos cas d'usage"
    debug('Recherche du bouton "Générer vos cas d\'usage"...');
    const generateButton = page.getByRole('button', { name: 'Générer vos cas d\'usage' });
    await expect(generateButton).toBeVisible({ timeout: 1000 });
    debug('Bouton trouvé, clic...');
    await generateButton.click();
    debug('Bouton cliqué, attente redirection...');
    
    // Vérifier la redirection vers /dossiers (comportement après génération avec nouveau dossier)
    debug('Attente redirection vers /dossiers...');
    await page.waitForURL('/dossiers', { timeout: 1000 });
    debug(`Redirection réussie vers /dossiers, URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /dossiers chargée');
    
    // Attendre 100ms pour l'affichage initial de Svelte
    await page.waitForTimeout(100);
    
    // Attendre qu'une carte Delpharm sans "En cours…" apparaisse avec des cas d'usage > 0 (génération terminée)
    // Note: "En cours…" disparaît vite (remplacé par raisonnement/appels outils), mais le nombre de cas d'usage n'apparaît qu'après ~20 secondes
    // Utiliser une boucle pour vérifier toutes les 3 secondes jusqu'à 30 secondes (10 tentatives)
    let folderCardWithCompany;
    let folderAttempts = 0;
    const maxFolderAttempts = 10; // 10 tentatives * 3 secondes = 30 sec max
    
    debug('Attente de la fin de génération du dossier Delpharm...');
    
    // Vérifier immédiatement si la carte Delpharm existe (avant la boucle)
    const initialDelpharmCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Delpharm' });
    const initialDelpharmCount = await initialDelpharmCards.count();
    debug(`Vérification initiale: ${initialDelpharmCount} carte(s) Delpharm trouvée(s)`);
    
    while (folderAttempts < maxFolderAttempts) {
      // Chercher toutes les cartes Delpharm
      const allDelpharmCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Delpharm' });
      const allDelpharmCount = await allDelpharmCards.count();
      debug(`Tentative ${folderAttempts + 1}/${maxFolderAttempts}: ${allDelpharmCount} carte(s) Delpharm trouvée(s)`);
      
      if (allDelpharmCount > 0) {
        // Filtrer les cartes sans "En cours…"
        const availableCards = allDelpharmCards.filter({ hasNotText: 'En cours…' });
        const count = await availableCards.count();
        debug(`Cartes Delpharm sans "En cours…": ${count}`);
        
        if (count > 0) {
          // Prendre la première carte qui a des cas d'usage > 0
          for (let i = 0; i < count; i++) {
            const candidateCard = availableCards.nth(i);
            
            // Chercher spécifiquement l'élément span qui contient l'icône dossier (SVG) et le texte "cas d'usage"
            // Le span a la structure: <span class="flex items-center gap-1 whitespace-nowrap"><svg>...</svg> {useCaseCount} cas d'usage</span>
            // On cherche le span qui contient à la fois un SVG et le texte "cas d'usage"
            const useCaseCountElement = candidateCard.locator('span:has(svg):has-text("cas d\'usage")');
            const useCaseCountExists = await useCaseCountElement.count() > 0;
            
            if (useCaseCountExists) {
              const useCaseCountText = await useCaseCountElement.textContent();
              // Extraire le nombre depuis le texte du span (format: "3 cas d'usage")
              const useCaseMatch = useCaseCountText?.match(/(\d+)\s+cas\s+d'usage/);
              const useCaseCount = useCaseMatch ? parseInt(useCaseMatch[1], 10) : 0;
              
              if (useCaseCount > 0) {
                folderCardWithCompany = candidateCard;
                debug(`✅ Carte dossier Delpharm terminée avec ${useCaseCount} cas d'usage trouvée`);
                break;
              }
            }
          }
          if (folderCardWithCompany) {
            break;
          } else {
            debug(`⏳ Cartes trouvées mais pas encore de cas d'usage (icône dossier non trouvée ou compteur = 0)`);
          }
        }
      }
      
      await page.waitForTimeout(3000); // Attendre 3 secondes avant de réessayer (la page se met à jour automatiquement)
      folderAttempts++;
      debug(`Attente de la mise à jour automatique (tentative ${folderAttempts}/${maxFolderAttempts})...`);
    }
    
    if (!folderCardWithCompany) {
      // Log final pour debug
      const allCards = page.locator('.grid.gap-4 > article');
      const allCardsCount = await allCards.count();
      debug(`ERROR: Aucune carte dossier terminée trouvée. Total cartes sur la page: ${allCardsCount}`);
      if (allCardsCount > 0) {
        const allCardsText = await allCards.allTextContents();
        debug(`ERROR: Textes de toutes les cartes: ${JSON.stringify(allCardsText)}`);
      }
      throw new Error('La génération du dossier Delpharm n\'a pas terminé dans les délais (30 secondes)');
    }
    
    // Cliquer sur la carte et attendre la navigation
    await Promise.all([
      page.waitForURL(/\/cas-usage/, { timeout: 2000 }),
      folderCardWithCompany.click()
    ]);
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier le titre "Cas d'usage"
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Étape 1: Attendre qu'au moins une carte de cas d'usage apparaisse (même en génération)
    // Playwright attend automatiquement jusqu'à ce que l'élément soit visible (timeout 5s pour l'appel API)
    debug('Étape 1: Attente de l\'apparition des cartes de cas d\'usage...');
    const allCards = page.locator('.grid.gap-4 > article');
    await expect(allCards.first()).toBeVisible({ timeout: 5000 });
    debug('✅ Au moins une carte de cas d\'usage est visible');
    
    // Étape 2: Attendre la fin de génération du premier cas d'usage (pas en génération)
    debug('Étape 2: Attente de la fin de génération d\'un cas d\'usage...');
    let firstUseCaseCard;
    let attempts = 0;
    // CI can be significantly slower for AI generation; allow up to ~3 minutes.
    const maxAttempts = 60; // 60 tentatives * 3 secondes = 180 sec max
    
    while (attempts < maxAttempts) {
      // D'abord, voir toutes les cartes pour debug
      const allCards = page.locator('.grid.gap-4 > article');
      const allCardsCount = await allCards.count();
      debug(`Tentative ${attempts + 1}/${maxAttempts}: ${allCardsCount} carte(s) totale(s)`);
      
      if (allCardsCount > 0) {
        // Afficher le statut de chaque carte
        for (let i = 0; i < allCardsCount; i++) {
          const card = allCards.nth(i);
          const cardText = await card.textContent();
          const hasGenerating = await card.filter({ hasText: 'Génération en cours' }).count() > 0;
          const hasCompleted = await card.filter({ hasText: 'Cliquez pour voir les détails' }).count() > 0;
          debug(`Carte ${i + 1}: génération=${hasGenerating}, terminé=${hasCompleted}`);
          debug(`Texte: "${cardText?.substring(0, 120)}..."`);
        }
      }
      
      // Chercher les cartes terminées : elles ont "Cliquez pour voir les détails" dans le footer
      // (cette phrase n'apparaît que quand la génération est terminée, pas pendant "Génération en cours...")
      const completedCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Cliquez pour voir les détails' });
      const count = await completedCards.count();
      debug(`Cartes terminées (avec "Cliquez pour voir les détails"): ${count}`);
      
      if (count > 0) {
        firstUseCaseCard = completedCards.first();
        const cardText = await firstUseCaseCard.textContent();
        debug(`✅ Cas d'usage terminé trouvé: "${cardText?.substring(0, 100)}..."`);
        break;
      }
      
      await page.waitForTimeout(3000); // Attendre 3 secondes avant de réessayer (la page se met à jour automatiquement)
      attempts++;
      debug(`Attente de la mise à jour automatique (tentative ${attempts}/${maxAttempts})...`);
    }
    
    if (!firstUseCaseCard) {
      // Log final pour debug
      const allCards = page.locator('.grid.gap-4 > article');
      const allCardsCount = await allCards.count();
      debug(`ERROR: Aucun cas d'usage terminé trouvé. Total cartes: ${allCardsCount}`);
      if (allCardsCount > 0) {
        const allCardsText = await allCards.allTextContents();
        debug(`ERROR: Textes de toutes les cartes: ${JSON.stringify(allCardsText)}`);
        // Vérifier aussi avec les textes possibles
        const generatingCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Génération en cours' });
        const generatingCount = await generatingCards.count();
        debug(`ERROR: Cartes avec "Génération en cours": ${generatingCount}`);
        const completedCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Cliquez pour voir les détails' });
        const completedCount = await completedCards.count();
        debug(`ERROR: Cartes terminées (avec "Cliquez pour voir les détails"): ${completedCount}`);
      }
      throw new Error('Aucun cas d\'usage n\'a terminé sa génération dans les délais (180 secondes)');
    }
    
    // Cliquer sur le premier cas d'usage
    await firstUseCaseCard.click();
    await page.waitForURL(/\/cas-usage\/[a-zA-Z0-9-]+/, { timeout: 1000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier la section Références
    const referencesSection = page.locator('text=Références').first();
    await expect(referencesSection).toBeVisible({ timeout: 1000 });
    
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
    
    const message1 = 'Quel est le nom de ce cas d\'usage ?';
    await composer.fill(message1);
    await composer.press('Enter');
    
    const userMessage1 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 5000 });
    
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse1 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse1).toBeVisible({ timeout: 30_000 });
    
    // Test 2: update_usecase_field
    debug('Test Chat: update_usecase_field');
    
    const message2 = 'Ajoute "Test E2E" au début de la description';
    await composer.fill(message2);
    await composer.press('Enter');
    
    const userMessage2 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message2 }).first();
    await expect(userMessage2).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (avec tool call update_usecase_field)
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse2 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse2).toBeVisible({ timeout: 30_000 });
    
    // Vérifier que la modification apparaît en direct via SSE (pas de refresh)
    // Note: la modification peut prendre quelques secondes via SSE, on attend jusqu'à 5s
    // On cherche "Test E2E" n'importe où dans la page (dans la description)
    await expect(page.locator('body')).toContainText('Test E2E', { timeout: 5000 });
    
    // Test 3: web_extract (on a déjà vérifié qu'il y a des références)
    debug('Test Chat: web_extract');
    const message3 = 'Analyse les références en détail';
    await composer.fill(message3);
    await composer.press('Enter');
    
    const userMessage3 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message3 }).first();
    await expect(userMessage3).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (avec tool call web_extract)
    // On cherche le dernier message assistant (div.flex.justify-start)
    const assistantResponse3 = page.locator('div.flex.justify-start').last();
    await expect(assistantResponse3).toBeVisible({ timeout: 30_000 });
  });
});
