import { test, expect } from '@playwright/test';

// Timeout pour génération IA (gpt-4.1-nano = réponses rapides)
test.setTimeout(10_000); // 10 secondes max

test.describe('Chat', () => {
  test('devrait ouvrir le chat, envoyer un message et recevoir une réponse', async ({ page }) => {
    // Aller sur une page simple (pas besoin de contexte spécifique)
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    
    // Attendre que la page soit chargée (Svelte est réactif, timeout 1s)
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget (bouton en bas à droite)
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible (le panneau remplace la bulle)
    // Le panneau a une classe spécifique et contient le textarea (Svelte est réactif, timeout 1s)
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message avec une demande de réponse spécifique pour vérifier la réponse
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    await composer.fill(message);
    await composer.press('Enter');
    
    // Attendre que le message utilisateur apparaisse dans la liste (fond sombre, aligné à droite)
    // Svelte est réactif, le message apparaît immédiatement (timeout 1s)
    const userMessage = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse avec le texte spécifique demandé
    // On cherche directement le texte "OK" dans le dernier message assistant qui le contient
    const assistantResponse = page.locator('div.flex.justify-start').filter({ hasText: expectedResponse }).last();
    await expect(assistantResponse).toBeVisible({ timeout: 5000 });
  });

  test('devrait basculer entre Chat et Jobs IA dans le widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau soit visible
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Basculer vers Jobs IA via le sélecteur dans le header
    // Le select contient "Nouvelle session", les sessions existantes, et "Jobs IA"
    const headerSelect = page.locator('select[title="Session / Jobs"]');
    await expect(headerSelect).toBeVisible({ timeout: 1000 });
    
    // Sélectionner l'option Jobs IA par sa valeur
    await headerSelect.selectOption({ value: '__jobs__' });
    
    // Vérifier que le panneau Jobs IA est visible (pas le chat)
    await expect(composer).not.toBeVisible({ timeout: 1000 });
    
    // Basculer de retour vers Chat
    await headerSelect.selectOption('__new__');
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: 1000 });
  });

  test('devrait maintenir la conversation avec plusieurs messages', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un premier message avec une réponse spécifique
    const expectedResponse1 = 'OK';
    const message1 = `Réponds uniquement avec le mot ${expectedResponse1}`;
    await composer.fill(message1);
    await composer.press('Enter');
    
    // Attendre que le message utilisateur apparaisse
    const userMessage1 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 1000 });
    
    // Attendre la réponse de l'assistant avec le texte spécifique
    // On cherche directement le texte dans le dernier message assistant qui le contient
    const assistantResponse1 = page.locator('div.flex.justify-start').filter({ hasText: expectedResponse1 }).last();
    await expect(assistantResponse1).toBeVisible({ timeout: 5000 });
    
    // Envoyer un deuxième message dans la même session avec une autre réponse spécifique
    const expectedResponse2 = 'BON';
    const message2 = `Réponds encore uniquement avec le mot ${expectedResponse2}`;
    await composer.fill(message2);
    await composer.press('Enter');
    
    // Vérifier que les deux messages utilisateur sont visibles
    const userMessage2 = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message2 }).first();
    await expect(userMessage2).toBeVisible({ timeout: 1000 });
    
    // Vérifier qu'il y a au moins 2 messages assistant (conversation continue)
    const assistantMessages = page.locator('div.flex.justify-start');
    const assistantCount = await assistantMessages.count();
    expect(assistantCount).toBeGreaterThanOrEqual(2);
  });

  test('devrait conserver la session après fermeture et réouverture du widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session
    const message = 'Test session conservation';
    await composer.fill(message);
    await composer.press('Enter');
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (peu importe le contenu, on teste la conservation de session)
    // On cherche le dernier message assistant qui contient du texte visible (pas seulement des espaces)
    const assistantResponse = page.locator('div.flex.justify-start div.rounded.bg-white.border.border-slate-200').last();
    await expect(assistantResponse).toBeVisible({ timeout: 3000 });
    
    // Fermer le widget (bouton X)
    const closeButton = page.locator('button[aria-label="Fermer"]');
    await expect(closeButton).toBeVisible({ timeout: 1000 });
    await closeButton.click();
    
    // Vérifier que le widget est fermé (le textarea n'est plus visible)
    await expect(composer).not.toBeVisible({ timeout: 1000 });
    
    // Rouvrir le widget
    await chatButton.click();
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Vérifier que le message précédent est toujours là (session conservée)
    await expect(userMessage).toBeVisible({ timeout: 1000 });
  });

  test('devrait lister les sessions dans le sélecteur après création', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    // On demande explicitement de ne PAS utiliser d'outils
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    await composer.fill(message);
    await composer.press('Enter');
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre la réponse de l'assistant avec le texte spécifique
    // On cherche directement le texte dans le dernier message assistant qui le contient
    const assistantResponse = page.locator('div.flex.justify-start').filter({ hasText: expectedResponse }).last();
    await expect(assistantResponse).toBeVisible({ timeout: 3000 });
    
    // Vérifier que le sélecteur contient maintenant une session (en plus de "Nouvelle session" et "Jobs IA")
    const headerSelect = page.locator('select[title="Session / Jobs"]');
    const options = headerSelect.locator('option');
    const optionCount = await options.count();
    // Au minimum : "Nouvelle session" + "Jobs IA" + au moins 1 session = 3 options minimum
    expect(optionCount).toBeGreaterThanOrEqual(3);
  });

  test('devrait supprimer une session', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('textarea[placeholder="Écrire un message…"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    await composer.fill(message);
    await composer.press('Enter');
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('div.flex.justify-end .bg-slate-900.text-white').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre la réponse de l'assistant avec le texte spécifique
    // On cherche directement le texte dans le dernier message assistant qui le contient
    const assistantResponse = page.locator('div.flex.justify-start').filter({ hasText: expectedResponse }).last();
    await expect(assistantResponse).toBeVisible({ timeout: 5000 });
    
    // Vérifier qu'une session existe dans le sélecteur
    const headerSelect = page.locator('select[title="Session / Jobs"]');
    const initialOptionCount = await headerSelect.locator('option').count();
    expect(initialOptionCount).toBeGreaterThanOrEqual(3); // Au moins "Nouvelle session" + "Jobs IA" + 1 session
    
    // Cliquer sur le bouton de suppression (icône poubelle)
    const deleteButton = page.locator('button[title="Supprimer la conversation"]');
    await expect(deleteButton).toBeVisible({ timeout: 1000 });
    
    // Configurer le handler pour le dialogue de confirmation
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('confirm');
      dialog.accept();
    });
    
    await deleteButton.click();
    
    // Attendre que les messages aient disparu (la session est supprimée)
    await expect(userMessage).not.toBeVisible({ timeout: 15000 });
    
    // Vérifier que le sélecteur est revenu à "Nouvelle session" ou qu'il n'y a plus de messages
    const finalOptionCount = await headerSelect.locator('option').count();
    // Après suppression, on devrait avoir au moins "Nouvelle session" + "Jobs IA" = 2 options minimum
    expect(finalOptionCount).toBeGreaterThanOrEqual(2);
  });

});

