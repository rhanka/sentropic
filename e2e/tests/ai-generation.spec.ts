import { test, expect } from '@playwright/test';
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
    const companyCardEnriching = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasText: 'Enrichissement en cours...' }).first();
    await expect(companyCardEnriching).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'une carte BRP sans "Enrichissement en cours..." apparaisse (enrichissement terminé)
    // Utiliser une boucle pour vérifier toutes les 3 secondes jusqu'à 30 secondes (10 tentatives)
    let companyCard;
    let attempts = 0;
    const maxAttempts = 10; // 10 tentatives * 3 secondes = 30 sec max
    
    while (attempts < maxAttempts) {
      const availableCards = page.locator('article').filter({ hasText: 'BRP' }).filter({ hasNotText: 'Enrichissement en cours...' });
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
    
    // Attendre que les entreprises soient chargées
    await page.waitForTimeout(1000);
    debug('Recherche de la textarea...');
    
    // Remplir la textarea avec le prompt
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 1000 });
    debug('Textarea trouvée, remplissage...');
    await textarea.fill('Génère 3 cas d\'usage pour l\'extension de l\'usine de Boucherville');
    debug('Textarea remplie');
    
    // Sélectionner l'entreprise contenant Delpharm
    debug('Recherche du select entreprise...');
    const companySelect = page.getByLabel('Entreprise (optionnel)');
    await expect(companySelect).toBeVisible({ timeout: 1000 });
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
    await page.waitForURL('/dossiers', { timeout: 2000 });
    debug(`Redirection réussie vers /dossiers, URL: ${page.url()}`);
    await page.waitForLoadState('domcontentloaded');
    debug('Page /dossiers chargée');
    
    // Vérifier que la carte contenant Delpharm est en status "generating"
    debug('Recherche de la carte dossier Delpharm en génération...');
    const folderCardWithCompanyGenerating = page.locator('.grid.gap-4 > article').filter({ hasText: 'Delpharm' }).filter({ hasText: 'Génération' }).first();
    await expect(folderCardWithCompanyGenerating).toBeVisible({ timeout: 1000 });
    await expect(folderCardWithCompanyGenerating.locator('text=Génération...')).toBeVisible();
    debug('✅ Carte dossier Delpharm en génération trouvée');
    
    // Attendre qu'une carte Company sans "Génération..." apparaisse (génération terminée)
    // Utiliser une boucle pour vérifier toutes les 3 secondes jusqu'à 30 secondes (10 tentatives)
    let folderCardWithCompany;
    let folderAttempts = 0;
    const maxFolderAttempts = 15; // 15 tentatives * 3 secondes = 45 sec max
    
    debug('Attente de la fin de génération du dossier Delpharm...');
    while (folderAttempts < maxFolderAttempts) {
      // D'abord, voir toutes les cartes Delpharm pour debug
      const allDelpharmCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Delpharm' });
      const allDelpharmCount = await allDelpharmCards.count();
      debug(`Tentative ${folderAttempts + 1}/${maxFolderAttempts}: ${allDelpharmCount} carte(s) Delpharm trouvée(s)`);
      
      if (allDelpharmCount > 0) {
        // Afficher le texte de toutes les cartes Delpharm
        for (let i = 0; i < allDelpharmCount; i++) {
          const cardText = await allDelpharmCards.nth(i).textContent();
          debug(`Carte Delpharm ${i + 1}: "${cardText?.substring(0, 100)}..."`);
        }
      }
      
      const availableCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Delpharm' }).filter({ hasNotText: 'Génération...' });
      const count = await availableCards.count();
      debug(`Cartes Delpharm sans "Génération...": ${count}`);
      
      if (count > 0) {
        folderCardWithCompany = availableCards.first();
        const cardText = await folderCardWithCompany.textContent();
        debug(`✅ Carte dossier Delpharm terminée trouvée: "${cardText?.substring(0, 100)}..."`);
        break;
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
    
    // Cliquer sur le dossier
    await folderCardWithCompany.click();
    
    // Vérifier la redirection vers /cas-usage
    await page.waitForURL(/\/cas-usage/, { timeout: 2000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier le titre "Cas d'usage"
    await expect(page.locator('h1')).toContainText('Cas d\'usage');
    
    // Étape 1: Attendre qu'au moins une carte de cas d'usage apparaisse (même en génération)
    // Pour s'assurer que les cas d'usage sont chargés depuis l'API
    debug('Étape 1: Attente de l\'apparition des cartes de cas d\'usage...');
    let anyCardVisible = false;
    let loadingAttempts = 0;
    const maxLoadingAttempts = 3; // 3 tentatives * 1.5 secondes = 4.5 sec max pour le chargement initial
    
    while (loadingAttempts < maxLoadingAttempts) {
      const allCards = page.locator('.grid.gap-4 > article');
      const cardCount = await allCards.count();
      debug(`Tentative ${loadingAttempts + 1}/${maxLoadingAttempts}: ${cardCount} carte(s) de cas d'usage trouvée(s)`);
      
      if (cardCount > 0) {
        // Afficher le texte de toutes les cartes pour debug
        const allCardsText = await allCards.allTextContents();
        debug(`Textes des cartes trouvées: ${JSON.stringify(allCardsText.map(t => t.substring(0, 80) + '...'))}`);
        anyCardVisible = true;
        break;
      }
      
      await page.waitForTimeout(1500); // Attendre 1.5 secondes avant de réessayer (la page se met à jour automatiquement)
      loadingAttempts++;
      debug(`Attente de la mise à jour automatique (tentative ${loadingAttempts}/${maxLoadingAttempts})...`);
    }
    
    if (!anyCardVisible) {
      debug('ERROR: Aucune carte de cas d\'usage trouvée sur la page');
      throw new Error('Aucun cas d\'usage n\'est apparu sur la page dans les délais (4.5 secondes)');
    }
    debug('✅ Au moins une carte de cas d\'usage est visible');
    
    // Étape 2: Attendre la fin de génération du premier cas d'usage (pas en génération)
    debug('Étape 2: Attente de la fin de génération d\'un cas d\'usage...');
    let firstUseCaseCard;
    let attempts = 0;
    const maxAttempts = 15; // 15 tentatives * 3 secondes = 45 sec max
    
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
          const hasDetailing = await card.filter({ hasText: 'Détail en cours' }).count() > 0;
          const hasGeneratingDots = await card.filter({ hasText: 'Génération...' }).count() > 0;
          debug(`Carte ${i + 1}: génération=${hasGenerating}, détail=${hasDetailing}, génération...=${hasGeneratingDots}`);
          debug(`Texte: "${cardText?.substring(0, 120)}..."`);
        }
      }
      
      const availableCards = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Génération en cours' }).filter({ hasNotText: 'Détail en cours' });
      const count = await availableCards.count();
      debug(`Cartes sans "Génération en cours" ni "Détail en cours": ${count}`);
      
      if (count > 0) {
        firstUseCaseCard = availableCards.first();
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
        // Vérifier aussi avec les points de suspension
        const generatingCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Génération en cours...' });
        const generatingCount = await generatingCards.count();
        debug(`ERROR: Cartes avec "Génération en cours...": ${generatingCount}`);
        const generatingDotsCards = page.locator('.grid.gap-4 > article').filter({ hasText: 'Génération...' });
        const generatingDotsCount = await generatingDotsCards.count();
        debug(`ERROR: Cartes avec "Génération...": ${generatingDotsCount}`);
      }
      throw new Error('Aucun cas d\'usage n\'a terminé sa génération dans les délais (45 secondes)');
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
      const response = await page.request.fetch(href!);
      expect(response.ok()).toBeTruthy();
      expect(response.status()).toBeLessThan(400); // 2xx ou 3xx sont acceptables
    }
  });
});
