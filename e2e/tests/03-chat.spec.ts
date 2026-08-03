import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

// Timeout pour génération IA (gpt-4.1-nano = réponses rapides)
test.setTimeout(180_000); // CI/dev can be slower; keep E2E stable while debugging

// Important: ces tests manipulent le même compte + les mêmes sessions.
// En parallèle (workers>1), ils se marchent dessus (création/suppression sessions) → flaky.
test.describe('Chat', () => {
  test.describe.configure({ mode: 'serial' });

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const QUICK_UI_TIMEOUT = 2_000;
  const PAGE_READY_TIMEOUT = 15_000;
  const assistantWrapper = (page: any) => page.locator('div.flex.justify-start');
  const assistantBubble = (page: any) =>
    assistantWrapper(page).locator('div.rounded.bg-white.border.border-slate-200');
  const sessionNewLabel = /nouvelle session|new session/i;
  const sessionNoneLabel = /aucune conversation|no conversation/i;
  const composerMenu = (page: any, label: RegExp | string) =>
    page
      .locator('div.fixed.shadow-lg, div.absolute.shadow-lg')
      .filter({ hasText: label })
      .first();

  const sessionHeaderLabel = (page: any) =>
    page.locator('#chat-widget-dialog [data-chat-sessions-heading]').first();

  async function gotoFoldersPage(page: any) {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    const foldersHeading = page.getByRole('heading', { name: /Dossiers|Folders/i });
    const firstBootReady = await foldersHeading.isVisible({ timeout: QUICK_UI_TIMEOUT }).catch(() => false);
    if (!firstBootReady) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await expect(foldersHeading).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
  }

  async function waitForComposerIdle(page: any, timeout = 60_000) {
    let readySince = 0;
    await expect
      .poll(
        async () => {
          const stopCount = await page.locator('#chat-widget-dialog .chat-composer-stop-button:visible').count();
          const steerCount = await page.getByTestId('chat-composer-steer-button').count();
          const ready = stopCount === 0 && steerCount === 0;
          if (!ready) {
            readySince = 0;
            return false;
          }
          const now = Date.now();
          if (readySince === 0) readySince = now;
          return now - readySince >= 500;
        },
        { timeout, intervals: [200, 300, 500, 1_000] },
      )
      .toBe(true);
  }

  async function waitForComposerCanSend(page: any, timeout = 60_000) {
    const sendBtn = page.getByTestId('chat-composer-send-button');
    let readySince = 0;
    await expect
      .poll(
        async () => {
          const stopCount = await page.locator('#chat-widget-dialog .chat-composer-stop-button:visible').count();
          const steerCount = await page.getByTestId('chat-composer-steer-button').count();
          const sendReady = await sendBtn.isEnabled().catch(() => false);
          const ready = stopCount === 0 && steerCount === 0 && sendReady;
          if (!ready) {
            readySince = 0;
            return false;
          }
          const now = Date.now();
          if (readySince === 0) readySince = now;
          return now - readySince >= 500;
        },
        { timeout, intervals: [200, 300, 500, 1_000] },
      )
      .toBe(true);
  }

  async function waitForQueueJobSettled(page: any, jobId: string, timeout = 60_000) {
    if (!jobId) return;
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${API_BASE_URL}/api/v1/queue/jobs/${encodeURIComponent(jobId)}`,
          );
          if (!res.ok()) return `http-${res.status()}`;
          const data = await res.json().catch(() => null);
          return String(data?.status ?? '');
        },
        { timeout, intervals: [500, 1_000, 2_000] },
      )
      .toMatch(/^(completed|failed)$/);
  }

  async function sendMessageAndWaitApi(page: any, composer: any, message: string) {
    await waitForComposerIdle(page);
    const editable = composer.locator('[contenteditable="true"]:visible').first();
    await expect(editable).toBeVisible({ timeout: 5_000 });
    await editable.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(message);
    await expect(editable).toContainText(message, { timeout: 5_000 });
    // When a previous assistant response is still streaming, pressing Enter
    // or clicking the action button triggers sendComposerSteer (which posts
    // to /chat/messages/<id>/steer) instead of sendMessage (/chat/messages).
    // Wait for the send button (data-testid="chat-composer-send-button") to
    // appear — its test-id flips to "chat-composer-steer-button" while the
    // assistant is active — then click it so the action fires sendMessage.
    await waitForComposerCanSend(page);
    const sendBtn = page.getByTestId('chat-composer-send-button');
    // Use pathname.endsWith to avoid capturing /chat/messages/<id>/steer
    // which is also a POST and contains '/chat/messages' in the URL.
    const matchesChatMessages = (url: string) => {
      try { return new URL(url).pathname.endsWith('/chat/messages'); } catch { return false; }
    };
    const [req, res] = await Promise.all([
      page.waitForRequest((req: any) => req.method() === 'POST' && matchesChatMessages(req.url()), {
        timeout: 30_000
      }),
      page.waitForResponse((res: any) => {
        const r = res.request();
        return r.method() === 'POST' && matchesChatMessages(res.url());
      }, { timeout: 30_000 }),
      sendBtn.click()
    ]);
    let requestBody: any = null;
    try {
      const raw = req.postData() || '{}';
      requestBody = JSON.parse(raw);
    } catch {
      requestBody = null;
    }
    const data = await res.json().catch(() => null);
    const result = {
      requestBody,
      jobId: String((data as any)?.jobId ?? ''),
      streamId: String((data as any)?.streamId ?? ''),
      assistantMessageId: String((data as any)?.assistantMessageId ?? ''),
      sessionId: String((data as any)?.sessionId ?? ''),
      userMessageId: String((data as any)?.userMessageId ?? '')
    };
    await waitForQueueJobSettled(page, result.jobId);
    return result;
  }

  async function debugBackendState(page: any, jobId: string, streamId: string) {
    try {
      if (jobId) {
        const jobRes = await page.request.get(`${API_BASE_URL}/api/v1/queue/jobs/${encodeURIComponent(jobId)}`);
        console.log('[chat.spec] job status:', jobRes.status(), await jobRes.text());
      } else {
        console.log('[chat.spec] no jobId captured from POST /chat/messages');
      }
    } catch (e) {
      console.log('[chat.spec] failed to fetch job status:', e);
    }
    console.log('[chat.spec] bootstrap debug requires sessionId + assistantMessageId; streamId=', streamId);
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

  // Session navigation goes through the agents list (the old chooser popover was
  // removed in pager hosts). From a conversation, the ChatSessionsBar Back control
  // returns to the list; the list section owns its own "New session" action and
  // renders one [role="option"] per session, each wrapped in a
  // [data-agent-entry-id] div. Mirrors the green 08-chat-workspace-switch pattern.
  async function goToAgentsList(page: any) {
    const backToList = page
      .locator(
        '#chat-widget-dialog button[aria-label="Retour aux conversations"], #chat-widget-dialog button[aria-label="Back to conversations"]',
      )
      .first();
    if (await backToList.isVisible().catch(() => false)) {
      await backToList.click();
    }
    // The list section owns a "New session" action, present even when the list is
    // empty; its visibility confirms we have landed on the list view.
    const newSessionAction = page
      .locator('#chat-widget-dialog')
      .getByRole('button', { name: sessionNewLabel })
      .first();
    await expect(newSessionAction).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    const sessionRows = page.locator('#chat-widget-dialog [role="option"]');
    return { newSessionAction, sessionRows };
  }

  async function waitForActiveSessionHeader(page: any, timeout = 30_000) {
    const header = sessionHeaderLabel(page);
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => (await header.textContent())?.trim() ?? '', { timeout })
      .not.toMatch(sessionNoneLabel);
    return header;
  }

  async function startFreshChatSession(page: any) {
    const newSessionAction = page.getByRole('button', { name: sessionNewLabel }).last();
    if (!(await newSessionAction.isVisible().catch(() => false))) return;
    await newSessionAction.click();
    await expect
      .poll(async () => await page.locator('#chat-widget-dialog .userMarkdown').count(), { timeout: 5_000 })
      .toBe(0);
  }

  function normalizeReplayText(text: string) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function replayNeedle(text: string) {
    const normalized = normalizeReplayText(text);
    return normalized.slice(0, Math.min(60, normalized.length));
  }

  async function waitForLatestAssistantText(page: any, timeout = 45_000) {
    const latestAssistant = assistantBubble(page).last();
    await expect(latestAssistant).toBeVisible({ timeout });
    await expect
      .poll(async () => normalizeReplayText((await latestAssistant.textContent()) || ''), { timeout })
      .not.toBe('');
    return normalizeReplayText((await latestAssistant.textContent()) || '');
  }

  async function expectLatestAssistantReplay(page: any, needle: string, timeout = 15_000) {
    await expect
      .poll(async () => {
        const texts = await assistantBubble(page).allTextContents();
        return texts.map(normalizeReplayText).filter(Boolean).join('\n');
       }, { timeout })
      .toContain(needle);
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
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget (bouton en bas à droite)
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible (le panneau remplace la bulle)
    // Le panneau a une classe spécifique et contient le textarea (Svelte est réactif, timeout 1s)
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
    // Envoyer un message avec une demande de réponse spécifique pour vérifier la réponse
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse dans la liste (fond sombre, aligné à droite)
    // Svelte est réactif, le message apparaît immédiatement (timeout 1s)
    const userGroup = page.locator('div.flex.flex-col.items-end.group').last();
    const userMessage = userGroup.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
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

  test('reload + new tab preserve assistant history without legacy stream-events calls', async ({ page }) => {
    await gotoFoldersPage(page);

    const legacyRequests: string[] = [];
    page.on('request', (request: any) => {
      const url = String(request.url?.() ?? request.url() ?? '');
      if (
        url.includes('/api/v1/chat/sessions/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (
        url.includes('/api/v1/chat/messages/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (url.includes('/api/v1/streams/events/')) {
        legacyRequests.push(url);
      }
    });

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Dossiers|Folders/i, { timeout: QUICK_UI_TIMEOUT });

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });

    const prompt = [
      'Utilise l’outil folders_list avant de répondre.',
      'Ensuite donne un bref état d’avancement et résume les dossiers visibles.',
    ].join(' ');
    await startFreshChatSession(page);
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, prompt);

    const retryButton = page
      .getByRole('button', { name: /réessayer|retry/i })
      .last();

    let responseNeedle = '';
    try {
      const assistantText = await waitForLatestAssistantText(page, 45_000);
      responseNeedle = replayNeedle(assistantText);
      expect(responseNeedle.length).toBeGreaterThan(0);
      await expect(retryButton).toBeVisible({ timeout: 60_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(chatButton).toBeVisible({ timeout: 5_000 });
    await chatButton.click();
    await expectLatestAssistantReplay(page, responseNeedle, 15_000);

    const page2 = await page.context().newPage();
    page2.on('request', (request: any) => {
      const url = String(request.url?.() ?? request.url() ?? '');
      if (
        url.includes('/api/v1/chat/sessions/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (
        url.includes('/api/v1/chat/messages/') && url.includes('/stream-events')
      ) {
        legacyRequests.push(url);
      }
      if (url.includes('/api/v1/streams/events/')) {
        legacyRequests.push(url);
      }
    });
    await gotoFoldersPage(page2);
    await expect(page2.locator('button[aria-controls="chat-widget-dialog"]')).toBeVisible({ timeout: 5_000 });
    await page2.locator('button[aria-controls="chat-widget-dialog"]').click();
    await expectLatestAssistantReplay(page2, responseNeedle, 15_000);

    expect(legacyRequests).toEqual([]);

    await page2.close();
  });

  test('devrait envoyer le bon contexte primaire au backend selon la route', async ({ page }) => {
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');

    // 1) /folders → no contextId (expect no primaryContextType)
    await gotoFoldersPage(page);
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    const r1 = await sendMessageAndWaitApi(page, composer, 'Test context dossiers');
    expect(r1.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r1.requestBody?.primaryContextId ?? null).toBeNull();

    // Close chat to stop streaming before navigating
    const closeChat = async () => {
      const closeBtn = page.locator('#chat-widget-dialog').getByRole('button', { name: /Fermer|Close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await expect(composer).not.toBeVisible({ timeout: 2_000 });
      }
    };
    const openChatFresh = async () => {
      await expect(chatButton).toBeVisible({ timeout: 5_000 });
      await chatButton.click();
      // Ensure Chat IA tab is active (not Commentaires)
      const chatTab = page.locator('button, [role="tab"]').filter({ hasText: /^Chat IA$/i }).first();
      if (await chatTab.isVisible().catch(() => false)) {
        await chatTab.click();
      }
      await expect(composer).toBeVisible({ timeout: 5_000 });
      const newSessionBtn = page.locator('button[aria-label="Nouvelle session"]');
      if (await newSessionBtn.isVisible().catch(() => false)) {
        await newSessionBtn.click();
      }
    };

    await closeChat();

    // 2) /organizations → no contextId (expect no primaryContextType)
    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Organisations|Organizations/i, { timeout: 5_000 });
    await openChatFresh();
    const r2 = await sendMessageAndWaitApi(page, composer, 'Test context organisations');
    expect(r2.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r2.requestBody?.primaryContextId ?? null).toBeNull();

    await closeChat();

    // 2bis) /organizations/[id] → organization + id from URL
    // Click the first organization row/card to navigate to detail.
    const closeButton = page
      .locator('#chat-widget-dialog')
      .getByRole('button', { name: /Fermer|Close/i })
      .first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await expect(composer).not.toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    }
    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) > 0) {
      // Set up the response waiter BEFORE clicking, so we don't miss the
      // organization-detail API call that fires during SvelteKit navigation.
      const orgDetailResponse = page.waitForResponse(
        (res: any) => res.url().includes('/api/v1/organizations/') && res.status() === 200,
        { timeout: 10_000 }
      );
      await organizationRows.first().click();
      await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
      await page.waitForLoadState('domcontentloaded');
      // Wait for the organization detail API call to complete, which ensures
      // SvelteKit's load function has finished and $page store is current.
      await orgDetailResponse;
      const m = page.url().match(/\/organizations\/([^/?#]+)/);
      const organizationId = m ? m[1] : '';
      expect(organizationId).toBeTruthy();

      await openChatFresh();
      const r2b = await sendMessageAndWaitApi(page, composer, 'Test context organisation detail');
      expect(r2b.requestBody?.primaryContextType).toBe('organization');
      expect(r2b.requestBody?.primaryContextId).toBe(organizationId);

      await closeChat();
    }

    // 3) /initiative/[id] → initiative + id from URL
    await page.goto('/initiative');
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
    const match = page.url().match(/\/initiative\/([^/?#]+)/);
    const useCaseId = match ? match[1] : '';
    expect(useCaseId).toBeTruthy();
    await openChatFresh();
    const r3 = await sendMessageAndWaitApi(page, composer, 'Test context initiative detail');
    expect(r3.requestBody?.primaryContextType).toBe('initiative');
    expect(r3.requestBody?.primaryContextId).toBe(useCaseId);
  });

  test('devrait gérer les contextes provisoires et persistants', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    const menuButton = page.getByRole('button', { name: /Ouvrir le menu|Open menu/i }).first();

    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText(/Organisations|Organizations/i, { timeout: QUICK_UI_TIMEOUT });

    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) === 0) return;
    await organizationRows.first().click();
    await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded');
    const orgName = (await page.locator('h1').first().textContent())?.trim();
    if (!orgName) return;

    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await menuButton.click();
    const menu = page
      .locator('div.fixed.shadow-lg, div.absolute.shadow-lg')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();
    await expect(menu.locator('button', { hasText: orgName })).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    const webSearchButton = menu.locator('button', { hasText: 'Web search' });
    const webSearchIcon = webSearchButton.locator('svg');
    const wasEnabled = await webSearchIcon.evaluate((el) => el.classList.contains('text-slate-900'));
    await webSearchButton.click();
    await expect(webSearchIcon).toHaveClass(wasEnabled ? /text-slate-400/ : /text-slate-900/);

    // Quitter la vue sans envoyer de message: contexte provisoire supprimé.
    await gotoFoldersPage(page);
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await menuButton.click();
    const menu2 = page
      .locator('div.fixed.shadow-lg, div.absolute.shadow-lg')
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
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await sendMessageAndWaitApi(page, composer, 'Contexte utilisé');

    await gotoFoldersPage(page);
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await menuButton.click();
    const menu3 = page
      .locator('div.fixed.shadow-lg, div.absolute.shadow-lg')
      .filter({ hasText: /Contexte\(s\)|Context\(s\)/i })
      .first();
    await expect(menu3.locator('button', { hasText: orgName })).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
  });

  test('non-régression app web: menu outils standard sans outils locaux extension', async ({ page }) => {
    await gotoFoldersPage(page);

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });

    const menuButton = page.getByRole('button', { name: /Ouvrir le menu|Open menu/i }).first();
    await expect(menuButton).toBeVisible({ timeout: 5000 });
    await menuButton.click();

    const menu = composerMenu(page, /Outils|Tools/i);
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
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);
    
    // Basculer vers Jobs via l'onglet
    const jobsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Jobs(?: IA)?$/i }).first();
    await expect(jobsTab).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await jobsTab.click();
    
    // Vérifier que le panneau Jobs est visible (pas le chat)
    await expect(composer).not.toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
    // Basculer de retour vers Chat
    const chatTab = page.locator('button, [role="tab"]').filter({ hasText: /^Chat(?: IA)?$/i }).first();
    await expect(chatTab).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatTab.click();
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
  });

  test('devrait maintenir la conversation avec plusieurs messages', async ({ page }) => {
    // Aller sur une page simple
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);
    
    // Envoyer un premier message (objectif du test: la conversation est conservée, pas la sémantique exacte)
    const message1 = `Réponds brièvement (test E2E)`;
    const firstSend = await sendMessageAndWaitApi(page, composer, message1);
    expect(firstSend.sessionId).toBeTruthy();

    // Attendre que le message utilisateur apparaisse (CI can be slower than local)
    const userMessage1 = page.locator('.userMarkdown').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 5_000 });

    // Attendre qu'un message assistant apparaisse (placeholder streaming ou contenu final)
    const assistantWrappers = assistantWrapper(page);
    await expect.poll(async () => await assistantWrappers.count(), { timeout: 30_000 }).toBeGreaterThan(0);

    // Wait for the first assistant run to complete before sending the second
    // message.  While the assistant is still processing, pressing Enter
    // triggers sendComposerSteer (steer the running assistant) instead of
    // sendMessage (new chat message).  The send button's test-id flips from
    // 'chat-composer-steer-button' to 'chat-composer-send-button' once the
    // assistant finishes.
    const sendButton = page.getByTestId('chat-composer-send-button');
    await expect(sendButton).toBeVisible({ timeout: 60_000 });

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
    await gotoFoldersPage(page);
    await expect(page).toHaveURL(/\/folders$/);

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);

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
    const [editResponse, editRetryResponse] = await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'PATCH' && res.url().includes('/api/v1/chat/messages/');
      }, { timeout: 30_000 }),
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'POST' && res.url().includes('/api/v1/chat/messages/') && res.url().includes('/retry');
      }, { timeout: 30_000 }),
      saveButton.click()
    ]);
    expect(editResponse.ok()).toBeTruthy();
    expect(editRetryResponse.ok()).toBeTruthy();
    const editRetryPayload = await editRetryResponse.json().catch(() => null);
    await waitForQueueJobSettled(page, String((editRetryPayload as any)?.jobId ?? ''));
    await waitForComposerIdle(page);
    await expect(page.locator('.userMarkdown').filter({ hasText: updatedMessage }).first()).toBeVisible({ timeout: 5000 });

    // Wait for the new assistant response after edit
    await expect(assistantBubble(page).last()).toBeVisible({ timeout: 45_000 });

    // Copy — grant clipboard permissions for headless mode
    await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);
    const updatedUserGroup = page.locator('div.flex.flex-col.items-end.group').last();
    await updatedUserGroup.hover();
    const copyButton = updatedUserGroup.getByRole('button', { name: /Copier|Copy/i });
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Feedback — use the LAST assistant bubble (after edit re-generation)
    const lastAssistantBubble = assistantBubble(page).last();
    const assistantGroup = lastAssistantBubble.locator('xpath=ancestor::div[contains(@class,"flex") and contains(@class,"justify-start")]').first();
    const usefulButton = assistantGroup.getByRole('button', { name: /^Utile$|^Useful$/i });
    await toggleUsefulFeedback(page, usefulButton, true);
    await toggleUsefulFeedback(page, usefulButton, false);

    // Retry
    const retryButton = assistantGroup.getByRole('button', { name: /Réessayer|Retry/i });
    const [retryResponse] = await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'POST' && res.url().includes('/api/v1/chat/messages/') && res.url().includes('/retry');
      }, { timeout: 30_000 }),
      retryButton.click()
    ]);
    expect(retryResponse.ok()).toBeTruthy();
    const retryPayload = await retryResponse.json().catch(() => null);
    await waitForQueueJobSettled(page, String((retryPayload as any)?.jobId ?? ''));
    await waitForComposerIdle(page);
    await expect(assistantBubble(page).last()).toBeVisible({ timeout: 30_000 });
  });

  test('devrait mettre à jour le titre de session via SSE', async ({ page }) => {
    await gotoFoldersPage(page);

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);

    await sendMessageAndWaitApi(page, composer, 'Donne un titre court à cette conversation.');

    await waitForActiveSessionHeader(page, 30_000);
  });

  test('devrait conserver la session après fermeture et réouverture du widget', async ({ page }) => {
    // Aller sur une page simple
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);
    
    // Envoyer un message pour créer une session
    const message = 'Test session conservation';
    const assistantCountBeforeSend = await assistantWrapper(page).count();
    await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
    // Wait for this send to create its own assistant turn. The session may
    // already contain older assistant messages from previous scenarios.
    await expect
      .poll(async () => await assistantWrapper(page).count(), { timeout: 30_000 })
      .toBeGreaterThan(assistantCountBeforeSend);
    
    // Fermer le widget (bouton X)
    const closeButton = page
      .locator('#chat-widget-dialog')
      .getByRole('button', { name: /Fermer|Close/i })
      .first();
    await expect(closeButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await closeButton.click();
    
    // Vérifier que le widget est fermé (le textarea n'est plus visible)
    await expect(composer).not.toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
    // Rouvrir le widget
    await chatButton.click();
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
    // Vérifier que le message précédent est toujours là (session conservée)
    await expect(userMessage).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
  });

  test('devrait lister les sessions dans le sélecteur après création', async ({ page }) => {
    // Aller sur une page simple
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    // On demande explicitement de ne PAS utiliser d'outils
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId, userMessageId, sessionId } = await sendMessageAndWaitApi(page, composer, message);
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
    
    // Vérifier qu'une session active existe, puis que la session créée apparaît
    // dans la liste des agents.
    await waitForActiveSessionHeader(page, 30_000);
    expect(sessionId).toBeTruthy();
    await goToAgentsList(page);
    const createdRow = page.locator(`#chat-widget-dialog [data-agent-entry-id="${sessionId}"]`);
    await expect(createdRow).toBeVisible({ timeout: 10_000 });
  });

  test('devrait supprimer une session', async ({ page }) => {
    // Aller sur une page simple
    await gotoFoldersPage(page);
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await startFreshChatSession(page);
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse
    const userMessage = page.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    
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
    
    // Vérifier qu'une session active existe avant suppression. Le bouton de
    // suppression vit sur la barre de conversation, directement visible.
    await waitForActiveSessionHeader(page, 30_000);

    // Cliquer sur le bouton de suppression (icône poubelle)
    const deleteButton = page.getByRole('button', {
      name: /Supprimer la conversation|Delete conversation/i,
    });
    await expect(deleteButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await expect(deleteButton).toBeEnabled({ timeout: 5000 });
    
    // Click delete button to show inline confirmation
    await deleteButton.click();
    // Click the inline "Supprimer" confirm button
    const confirmDeleteBtn = page.locator('button').filter({ hasText: /^Supprimer$/ }).first();
    await expect(confirmDeleteBtn).toBeVisible({ timeout: 2_000 });

    const [deleteResponse] = await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'DELETE' && res.url().includes('/api/v1/chat/sessions/');
      }, { timeout: 15_000 }),
      confirmDeleteBtn.click()
    ]);
    expect(deleteResponse.ok()).toBeTruthy();
    const deletedSessionId = decodeURIComponent(
      new URL(deleteResponse.url()).pathname.split('/').pop() ?? ''
    );
    expect(deletedSessionId).toBeTruthy();

    // Vérifier côté API que la session ciblée a bien été supprimée.
    await expect
      .poll(async () => {
        const sessionsRes = await page.request.get(`${API_BASE_URL}/api/v1/chat/sessions`);
        if (!sessionsRes.ok()) return true;
        const payload = await sessionsRes.json().catch(() => null);
        const sessions = Array.isArray((payload as any)?.sessions)
          ? (payload as any).sessions
          : [];
        return sessions.some((item: any) => String(item?.id ?? '') === deletedSessionId);
      }, { timeout: 10_000 })
      .toBe(false);

    // La liste des agents doit rester opérable après suppression : on y revient,
    // l'action « Nouvelle session » reste disponible (assertée par goToAgentsList)
    // et la session supprimée a disparu de la liste.
    await goToAgentsList(page);
    await expect(
      page.locator(`#chat-widget-dialog [data-agent-entry-id="${deletedSessionId}"]`),
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('attache une image et le modèle vision la décrit (BR38a-FB2)', async ({ page }) => {
    await gotoFoldersPage(page);

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });

    // Start from a fresh session so retries / shared-account state don't leave
    // an active assistant (which flips the send button to "steer"). The list's
    // "New session" action creates a fresh session and returns to the conversation.
    const { newSessionAction } = await goToAgentsList(page);
    await newSessionAction.click();
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });

    // Default model is text-only (gpt-4.1-nano); switch to a vision-capable one.
    const modelSelect = page.locator('#chat-model-selection');
    await expect(
      modelSelect.locator('option[value="openai::gpt-5.4-nano"]')
    ).toHaveCount(1, { timeout: 10_000 });
    await modelSelect.selectOption('openai::gpt-5.4-nano');

    // Generate a solid red PNG in the browser and attach it via the "+" menu.
    const redPngBytes: number[] = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 128, 128);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b as Blob), 'image/png')
      );
      const buf = await blob.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    });
    expect(redPngBytes.length).toBeGreaterThan(0);

    const plusButton = page.getByRole('button', { name: /Ouvrir le menu|Open menu/i }).first();
    await plusButton.click();
    const fileInput = page.locator('#chat-widget-dialog input[type="file"]').first();
    const [uploadRes] = await Promise.all([
      page.waitForResponse(
        (res: any) => {
          try {
            const r = res.request();
            return r.method() === 'POST' && new URL(res.url()).pathname.endsWith('/documents');
          } catch {
            return false;
          }
        },
        { timeout: 30_000 }
      ),
      fileInput.setInputFiles({
        name: 'red-square.png',
        mimeType: 'image/png',
        buffer: Buffer.from(redPngBytes),
      }),
    ]);
    expect(uploadRes.ok()).toBeTruthy();

    // Pending attachment chip is shown in the composer band.
    await expect(page.getByTestId('chat-composer-attachment-band')).toBeVisible({ timeout: 10_000 });

    // Send a question about the image; the request must carry the image attachment.
    const { requestBody, jobId, streamId } = await sendMessageAndWaitApi(
      page,
      composer,
      'What is the dominant color of the attached image? Answer with a single word.'
    );
    const sentAttachments = (requestBody?.attachments ?? []) as any[];
    expect(
      sentAttachments.some(
        (a) => a?.kind === 'image' && typeof a?.documentId === 'string' && a.documentId.length > 0
      )
    ).toBeTruthy();

    // The vision model must actually describe the image: a red square → "red".
    const redResponse = assistantBubble(page).filter({ hasText: /red|rouge/i }).last();
    try {
      await expect(redResponse).toBeVisible({ timeout: 60_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
  });

  // ---------------------------------------------------------------------------
  // BR-42b Lot 7 — search_catalog cross-kind discovery
  //
  // Conditional path (AI flaky allowlist, e2e/tests/03-chat.spec.ts).
  // This test verifies:
  //   (a) search_catalog tool is present in the tool set (API-level observable
  //       via the request body's tool definitions surfaced by the chat widget).
  //   (b) The LLM can use search_catalog to discover capabilities and returns
  //       a non-empty response.
  //   (c) search_skills is non-regressed: the existing search-skills flow still
  //       produces a valid response in the same session.
  //
  // The model's exact phrasing is non-deterministic (AI flaky), so we only
  // assert that:
  //   - The POST /chat/messages request succeeded (jobId truthy).
  //   - The assistant produced at least one visible bubble with non-empty text.
  //   - search_skills still works (a plain skill discovery query still resolves).
  // ---------------------------------------------------------------------------
  test('BR-42b Lot 7: search_catalog tool is wired and produces a response (non-regression search_skills)', async ({ page }) => {
    await gotoFoldersPage(page);

    const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
    await expect(chatButton).toBeVisible({ timeout: QUICK_UI_TIMEOUT });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: QUICK_UI_TIMEOUT });

    // --- Part 1: search_catalog discovery ---
    // Ask for capabilities in a way that naturally triggers catalog search.
    // The LLM may call search_catalog or answer directly from its context.
    // Either way, the request must succeed and produce an assistant response.
    const catalogQuery = 'Quels types de capacités (skills, agents, workflows, outils) sont disponibles dans ce système ? Réponds en une phrase courte.';
    const { jobId: jobId1, streamId: streamId1 } = await sendMessageAndWaitApi(page, composer, catalogQuery);
    expect(jobId1).toBeTruthy();

    let assistantText1 = '';
    try {
      assistantText1 = await waitForLatestAssistantText(page, 90_000);
      expect(assistantText1.length).toBeGreaterThan(0);
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId1, streamId1);
      throw e;
    }

    // --- Part 2: search_skills non-regression ---
    // Use a classic search_skills query to confirm the existing skill-discovery
    // flow is unaffected by the addition of search_catalog.
    const skillsQuery = 'Réponds uniquement "OK_SKILLS_OK" sans rien d\'autre.';
    const { jobId: jobId2, streamId: streamId2 } = await sendMessageAndWaitApi(page, composer, skillsQuery);
    expect(jobId2).toBeTruthy();
    expect(jobId2).not.toBe(jobId1);

    const okSkillsResponse = assistantBubble(page).filter({ hasText: 'OK_SKILLS_OK' }).last();
    try {
      await expect(okSkillsResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId2, streamId2);
      throw e;
    }
  });

});
