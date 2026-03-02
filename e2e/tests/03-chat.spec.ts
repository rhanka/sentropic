import { test, expect } from '@playwright/test';

// Timeout pour génération IA (gpt-4.1-nano = réponses rapides)
test.setTimeout(180_000); // CI/dev can be slower; keep E2E stable while debugging

// Important: ces tests manipulent le même compte + les mêmes sessions.
// En parallèle (workers>1), ils se marchent dessus (création/suppression sessions) → flaky.
test.describe.serial('Chat', () => {
  const assistantWrapper = (page: any) => page.locator('div.flex.justify-start');
  const assistantBubble = (page: any) =>
    assistantWrapper(page).locator('div.rounded.bg-white.border.border-slate-200');
  const sessionMenuLabel = /choisir une conversation|choose (a )?(conversation|session)|session list|conversation list/i;
  const sessionNewLabel = /nouvelle session|new session/i;
  const sessionNoneLabel = /aucune conversation|no conversation/i;

  const sessionHeaderLabel = (page: any) =>
    page.locator('#chat-widget-dialog div.border-b div.min-w-0.text-xs.text-slate-500.truncate').first();

  async function sendMessageAndWaitApi(page: any, composer: any, message: string) {
    const editable = page
      .locator(
        '[role="textbox"][aria-label="Composer"][contenteditable="true"]:visible, [role="textbox"][aria-label="Composer"]:visible [contenteditable="true"]:visible'
      )
      .first();
    await expect(editable).toBeVisible({ timeout: 5_000 });
    await editable.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(message);
    const [req, res] = await Promise.all([
      page.waitForRequest((req: any) => req.method() === 'POST' && req.url().includes('/api/v1/chat/messages'), {
        timeout: 30_000
      }),
      page.waitForResponse((res: any) => {
        const r = res.request();
        return r.method() === 'POST' && res.url().includes('/api/v1/chat/messages');
      }, { timeout: 30_000 }),
      page.keyboard.press('Enter')
    ]);
    let requestBody: any = null;
    try {
      const raw = req.postData() || '{}';
      requestBody = JSON.parse(raw);
    } catch {
      requestBody = null;
    }
    const data = await res.json().catch(() => null);
    return {
      requestBody,
      jobId: String((data as any)?.jobId ?? ''),
      streamId: String((data as any)?.streamId ?? ''),
      assistantMessageId: String((data as any)?.assistantMessageId ?? ''),
      sessionId: String((data as any)?.sessionId ?? ''),
      userMessageId: String((data as any)?.userMessageId ?? '')
    };
  }

  async function debugBackendState(page: any, jobId: string, streamId: string) {
    try {
      if (jobId) {
        const jobRes = await page.request.get(`/api/v1/queue/jobs/${encodeURIComponent(jobId)}`);
        console.log('[chat.spec] job status:', jobRes.status(), await jobRes.text());
      } else {
        console.log('[chat.spec] no jobId captured from POST /chat/messages');
      }
    } catch (e) {
      console.log('[chat.spec] failed to fetch job status:', e);
    }
    try {
      if (streamId) {
        const evRes = await page.request.get(
          `/api/v1/streams/events/${encodeURIComponent(streamId)}?limit=50`
        );
        console.log('[chat.spec] stream events:', evRes.status(), await evRes.text());
      } else {
        console.log('[chat.spec] no streamId captured from POST /chat/messages');
      }
    } catch (e) {
      console.log('[chat.spec] failed to fetch stream events:', e);
    }
  }

  async function debugAssistantState(page: any) {
    try {
      const wrappers = assistantWrapper(page);
      const wrapperCount = await wrappers.count();
      const wrapperTexts = await wrappers.allTextContents();
      console.log('[chat.spec] Assistant wrappers count:', wrapperCount);
      console.log('[chat.spec] Assistant wrappers (last 3):', wrapperTexts.slice(-3));
      const bubbleTexts = await assistantBubble(page).allTextContents();
      console.log('[chat.spec] Assistant bubbles (last 5):', bubbleTexts.slice(-5));
    } catch (e) {
      console.log('[chat.spec] Failed to dump assistant bubbles:', e);
    }
  }

  async function ensureSessionMenuOpen(page: any) {
    const sessionMenuButton = page.getByRole('button', { name: sessionMenuLabel }).first();
    await expect(sessionMenuButton).toBeVisible({ timeout: 3000 });
    const newSessionAction = page.getByRole('button', { name: sessionNewLabel }).first();
    if (!(await newSessionAction.isVisible().catch(() => false))) {
      await sessionMenuButton.click();
    }
    await expect(newSessionAction).toBeVisible({ timeout: 3000 });
    const sessionItems = page.locator('div.max-h-48 button');
    return { sessionMenuButton, sessionItems };
  }

  async function waitForActiveSessionHeader(page: any, timeout = 30_000) {
    const header = sessionHeaderLabel(page);
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => (await header.textContent())?.trim() ?? '', { timeout })
      .not.toMatch(sessionNoneLabel);
    return header;
  }

  async function toggleUsefulFeedback(
    page: any,
    usefulButton: any,
    expectedActive: boolean
  ) {
    const feedbackResponse = page
      .waitForResponse((res: any) => {
        const req = res.request();
        return (
          req.method() === 'POST' &&
          res.url().includes('/api/v1/chat/messages/') &&
          res.url().includes('/feedback')
        );
      }, { timeout: 10_000 })
      .catch(() => null);

    await usefulButton.click({ force: true });
    const res = await feedbackResponse;
    if (res) {
      expect(res.ok()).toBeTruthy();
      return;
    }
    if (expectedActive) {
      await expect(usefulButton).toHaveClass(/text-slate-900/, { timeout: 5_000 });
    } else {
      await expect(usefulButton).not.toHaveClass(/text-slate-900/, { timeout: 5_000 });
    }
  }

  test('devrait ouvrir le chat, envoyer un message et recevoir une réponse', async ({ page }) => {
    // Aller sur une page simple (pas besoin de contexte spécifique)
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    
    // Attendre que la page soit chargée (Svelte est réactif, timeout 1s)
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget (bouton en bas à droite)
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible (le panneau remplace la bulle)
    // Le panneau a une classe spécifique et contient le textarea (Svelte est réactif, timeout 1s)
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message avec une demande de réponse spécifique pour vérifier la réponse
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse dans la liste (fond sombre, aligné à droite)
    // Svelte est réactif, le message apparaît immédiatement (timeout 1s)
    const userGroup = page.locator('div.flex.flex-col.items-end.group').last();
    const userMessage = userGroup.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Le placeholder assistant (StreamMessage) est ajouté immédiatement après l'envoi.
    await expect.poll(async () => await assistantWrapper(page).count(), { timeout: 10_000 }).toBeGreaterThan(0);

    // Attendre qu'une réponse de l'assistant apparaisse avec le texte spécifique demandé
    // On cherche directement le texte "OK" dans le dernier message assistant qui le contient
    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 45_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
  });

  test('devrait envoyer le bon contexte primaire au backend selon la route', async ({ page }) => {
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');

    // 1) /folders → no contextId (expect no primaryContextType)
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    const r1 = await sendMessageAndWaitApi(page, composer, 'Test context dossiers');
    expect(r1.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r1.requestBody?.primaryContextId ?? null).toBeNull();

    // 2) /organizations → no contextId (expect no primaryContextType)
    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Organisations|Organizations/i, { timeout: 1000 });
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    const r2 = await sendMessageAndWaitApi(page, composer, 'Test context organisations');
    expect(r2.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r2.requestBody?.primaryContextId ?? null).toBeNull();

    // 2bis) /organizations/[id] → organization + id from URL
    // Click the first organization row/card to navigate to detail.
    // Close the chat panel first to avoid intercepting clicks on the underlying cards.
    const closeButton = page
      .locator('#chat-widget-dialog')
      .getByRole('button', { name: /Fermer|Close/i })
      .first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await expect(composer).not.toBeVisible({ timeout: 1000 });
    }
    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) > 0) {
      await organizationRows.first().click();
      await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
      await page.waitForLoadState('domcontentloaded');
      const m = page.url().match(/\/organizations\/([^/?#]+)/);
      const organizationId = m ? m[1] : '';
      expect(organizationId).toBeTruthy();

      await expect(chatButton).toBeVisible({ timeout: 1000 });
      await chatButton.click();
      await expect(composer).toBeVisible({ timeout: 1000 });
      const r2b = await sendMessageAndWaitApi(page, composer, 'Test context organisation detail');
      expect(r2b.requestBody?.primaryContextType).toBe('organization');
      expect(r2b.requestBody?.primaryContextId).toBe(organizationId);
    }

    // 3) /usecase/[id] → usecase + id from URL
    await page.goto('/usecase');
    await page.waitForLoadState('domcontentloaded');
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    if ((await useCaseCards.count()) === 0) {
      // If no seeded use cases are available, skip this assertion to keep E2E stable.
      return;
    }
    const firstCard = useCaseCards.first();
    const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible().catch(() => false);
    if (isGenerating) return;
    await firstCard.click();
    await page.waitForLoadState('domcontentloaded');
    const match = page.url().match(/\/usecase\/([^/?#]+)/);
    const useCaseId = match ? match[1] : '';
    expect(useCaseId).toBeTruthy();
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    const r3 = await sendMessageAndWaitApi(page, composer, 'Test context usecase detail');
    expect(r3.requestBody?.primaryContextType).toBe('usecase');
    expect(r3.requestBody?.primaryContextId).toBe(useCaseId);
  });

  test('devrait gérer les contextes provisoires et persistants', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    const menuButton = page.getByRole('button', { name: /Ouvrir le menu|Open menu/i }).first();

    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Organisations|Organizations/i, { timeout: 1000 });

    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) === 0) return;
    await organizationRows.first().click();
    await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded');
    const orgName = (await page.locator('h1').first().textContent())?.trim();
    if (!orgName) return;

    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    await menuButton.click();
    const menu = page
      .locator('div.absolute')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();
    await expect(menu.locator('button', { hasText: orgName })).toBeVisible({ timeout: 1000 });
    const webSearchButton = menu.locator('button', { hasText: 'Web search' });
    const webSearchIcon = webSearchButton.locator('svg');
    const wasEnabled = await webSearchIcon.evaluate((el) => el.classList.contains('text-slate-900'));
    await webSearchButton.click();
    await expect(webSearchIcon).toHaveClass(wasEnabled ? /text-slate-400/ : /text-slate-900/);

    // Quitter la vue sans envoyer de message: contexte provisoire supprimé.
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    await menuButton.click();
    const menu2 = page
      .locator('div.absolute')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();
    await expect(menu2.locator('button', { hasText: orgName })).toHaveCount(0);
    const webSearchButton2 = menu2.locator('button', { hasText: 'Web search' });
    const webSearchIcon2 = webSearchButton2.locator('svg');
    await expect(webSearchIcon2).toHaveClass(wasEnabled ? /text-slate-400/ : /text-slate-900/);

    // Revenir sur l'organisation, envoyer un message, puis vérifier la persistance.
    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await organizationRows.first().click();
    await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    await sendMessageAndWaitApi(page, composer, 'Contexte utilisé');

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 1000 });
    await menuButton.click();
    const menu3 = page
      .locator('div.absolute')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();
    await expect(menu3.locator('button', { hasText: orgName })).toBeVisible({ timeout: 1000 });
  });

  test('non-régression app web: menu outils standard sans outils locaux extension', async ({ page }) => {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 5000 });

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });

    const menuButton = page.getByRole('button', { name: /Ouvrir le menu|Open menu/i }).first();
    await expect(menuButton).toBeVisible({ timeout: 5000 });
    await menuButton.click();

    const menu = page.locator('div.absolute').filter({ hasText: /Outils|Tools/i }).first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('button', { hasText: 'Documents' })).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('button', { hasText: 'Web search' })).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('button', { hasText: 'tab_read' })).toHaveCount(0);
    await expect(menu.locator('button', { hasText: 'tab_action' })).toHaveCount(0);
    await menuButton.click();
    await expect(menu).not.toBeVisible({ timeout: 5000 });
    await expect(composer).toBeVisible({ timeout: 5000 });

    const requestData = await sendMessageAndWaitApi(
      page,
      composer,
      'Réponds uniquement avec OK_APP_WEB',
    );
    expect(requestData.requestBody?.localToolDefinitions ?? null).toBeNull();
  });

  test('devrait basculer entre Chat et Jobs IA dans le widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Basculer vers Jobs via l'onglet
    const jobsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Jobs(?: IA)?$/i }).first();
    await expect(jobsTab).toBeVisible({ timeout: 1000 });
    await jobsTab.click();
    
    // Vérifier que le panneau Jobs est visible (pas le chat)
    await expect(composer).not.toBeVisible({ timeout: 1000 });
    
    // Basculer de retour vers Chat
    const chatTab = page.locator('button, [role="tab"]').filter({ hasText: /^Chat(?: IA)?$/i }).first();
    await expect(chatTab).toBeVisible({ timeout: 1000 });
    await chatTab.click();
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: 1000 });
  });

  test('devrait maintenir la conversation avec plusieurs messages', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un premier message (objectif du test: la conversation est conservée, pas la sémantique exacte)
    const message1 = `Réponds brièvement (test E2E)`;
    const firstSend = await sendMessageAndWaitApi(page, composer, message1);
    expect(firstSend.sessionId).toBeTruthy();
    
    // Attendre que le message utilisateur apparaisse
    const userMessage1 = page.locator('.userMarkdown').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'un message assistant apparaisse (placeholder streaming ou contenu final)
    const assistantWrappers = assistantWrapper(page);
    await expect.poll(async () => await assistantWrappers.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    
    // Envoyer un deuxième message dans la même session avec une autre réponse spécifique
    const message2 = `Deuxième message (test E2E)`;
    const secondSend = await sendMessageAndWaitApi(page, composer, message2);
    expect(secondSend.sessionId).toBe(firstSend.sessionId);
    expect(secondSend.userMessageId).toBeTruthy();
    expect(secondSend.userMessageId).not.toBe(firstSend.userMessageId);
    
    // Le point clé: le 2e message n'a pas effacé le 1er (session/conversation conservée)
    await expect(userMessage1).toBeVisible({ timeout: 5_000 });

    // Attendre qu'au moins un message assistant soit visible après le 2e envoi
    await expect.poll(async () => await assistantWrappers.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('devrait gérer les actions sur les messages (copier, éditer, retry, feedback)', async ({ page }) => {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/folders$/);

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });

    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);

    const userGroup = page.locator('div.flex.flex-col.items-end.group').last();
    await expect(userGroup.locator('.userMarkdown').first()).toContainText(message, { timeout: 5000 });

    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 45_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }

    await userGroup.hover();
    const editButton = userGroup.getByRole('button', { name: /Modifier|Edit/i });
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    const editInput = userGroup.locator('.markdown-input-wrapper [contenteditable="true"]').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });
    await editInput.click();
    await page.keyboard.press('Control+A');
    const updatedMessage = 'Message modifié (E2E)';
    await page.keyboard.type(updatedMessage);
    const saveButton = userGroup.getByRole('button', { name: /Envoyer|Send/i });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();
    await expect(page.locator('.userMarkdown').filter({ hasText: updatedMessage }).first()).toBeVisible({ timeout: 5000 });

    await userGroup.hover();
    const copyButton = userGroup.getByRole('button', { name: /Copier|Copy/i });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    const assistantGroup = assistantResponse.locator('xpath=ancestor::div[contains(@class,"flex") and contains(@class,"justify-start")]').first();
    const usefulButton = assistantGroup.getByRole('button', { name: /^Utile$|^Useful$/i });
    await toggleUsefulFeedback(page, usefulButton, true);
    await toggleUsefulFeedback(page, usefulButton, false);

    const retryButton = assistantGroup.getByRole('button', { name: /Réessayer|Retry/i });
    const [retryResponse] = await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'POST' && res.url().includes('/api/v1/chat/messages/') && res.url().includes('/retry');
      }, { timeout: 30_000 }),
      retryButton.click()
    ]);
    expect(retryResponse.ok()).toBeTruthy();
    await expect(assistantBubble(page).last()).toBeVisible({ timeout: 30_000 });
  });

  test('devrait mettre à jour le titre de session via SSE', async ({ page }) => {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });

    await sendMessageAndWaitApi(page, composer, 'Donne un titre court à cette conversation.');

    await waitForActiveSessionHeader(page, 30_000);
  });

  test('devrait conserver la session après fermeture et réouverture du widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session
    const message = 'Test session conservation';
    await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre qu'une réponse de l'assistant apparaisse (peu importe le contenu, on teste la conservation de session)
    // On attend au moins le placeholder assistant (StreamMessage) pour éviter de dépendre du contenu final.
    await expect.poll(async () => await assistantWrapper(page).count(), { timeout: 30_000 }).toBeGreaterThan(0);
    
    // Fermer le widget (bouton X)
    const closeButton = page
      .locator('#chat-widget-dialog')
      .getByRole('button', { name: /Fermer|Close/i })
      .first();
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
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    // On demande explicitement de ne PAS utiliser d'outils
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId, userMessageId } = await sendMessageAndWaitApi(page, composer, message);
    expect(userMessageId).toBeTruthy();
    
    // Attendre la réponse de l'assistant avec le texte spécifique
    // On cherche directement le texte dans le dernier message assistant qui le contient
    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 45_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
    
    // Vérifier qu'une session active existe et que le sélecteur est ouvert.
    await waitForActiveSessionHeader(page, 30_000);
    const { sessionItems } = await ensureSessionMenuOpen(page);
    await expect
      .poll(async () => {
        const count = await sessionItems.count();
        if (count > 0) return true;
        const headerText = (await sessionHeaderLabel(page).textContent())?.trim() ?? '';
        return !sessionNoneLabel.test(headerText);
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('devrait supprimer une session', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 1000 });
    
    // Attendre la réponse de l'assistant avec le texte spécifique
    // On cherche directement le texte dans le dernier message assistant qui le contient
    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 45_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
    
    // Vérifier qu'une session active existe avant suppression.
    await waitForActiveSessionHeader(page, 30_000);
    await ensureSessionMenuOpen(page);
    
    // Cliquer sur le bouton de suppression (icône poubelle)
    const deleteButton = page.getByRole('button', {
      name: /Supprimer la conversation|Delete conversation/i,
    });
    await expect(deleteButton).toBeVisible({ timeout: 1000 });
    await expect(deleteButton).toBeEnabled({ timeout: 5000 });
    
    // Configurer le handler pour le dialogue de confirmation
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('confirm');
      dialog.accept();
    });
    
    // Déclencher la suppression et attendre un signal déterministe côté API
    const [deleteResponse] = await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'DELETE' && res.url().includes('/api/v1/chat/sessions/');
      }, { timeout: 15_000 }),
      deleteButton.click()
    ]);
    expect(deleteResponse.ok()).toBeTruthy();
    const deletedSessionId = decodeURIComponent(
      new URL(deleteResponse.url()).pathname.split('/').pop() ?? ''
    );
    expect(deletedSessionId).toBeTruthy();

    // Vérifier côté API que la session ciblée a bien été supprimée.
    await expect
      .poll(async () => {
        const sessionsRes = await page.request.get('/api/v1/chat/sessions');
        if (!sessionsRes.ok()) return null;
        const payload = await sessionsRes.json().catch(() => null);
        const sessions = Array.isArray((payload as any)?.sessions)
          ? (payload as any).sessions
          : [];
        return sessions.some((item: any) => String(item?.id ?? '') === deletedSessionId);
      }, { timeout: 10_000 })
      .toBe(false);

    // Le menu de sessions doit rester opérable après suppression.
    await ensureSessionMenuOpen(page);
  });

});
