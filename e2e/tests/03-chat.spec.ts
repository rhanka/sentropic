import { test, expect, request } from '@playwright/test';
import path from 'node:path';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// Timeout pour génération IA (gpt-4.1-nano = réponses rapides)
test.setTimeout(180_000); // CI/dev can be slower; keep E2E stable while debugging

// Important: ces tests manipulent le même compte + les mêmes sessions.
// En parallèle (workers>1), ils se marchent dessus (création/suppression sessions) → flaky.
test.describe.serial('Chat', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_STATE = './.auth/state.json';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_A_EMAIL = 'e2e-user-a@example.com';
  const assistantWrapper = (page: any) => page.locator('div.flex.justify-start');
  const assistantBubble = (page: any) =>
    assistantWrapper(page).locator('div.rounded.bg-white.border.border-slate-200');

  async function sendMessageAndWaitApi(page: any, composer: any, message: string) {
    const editable = composer.locator('[contenteditable="true"]');
    await editable.click();
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

  test('devrait ouvrir le chat, envoyer un message et recevoir une réponse', async ({ page }) => {
    // Aller sur une page simple (pas besoin de contexte spécifique)
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    
    // Attendre que la page soit chargée (Svelte est réactif, timeout 1s)
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 5000 });
    
    // Ouvrir le ChatWidget (bouton en bas à droite)
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible (le panneau remplace la bulle)
    // Le panneau a une classe spécifique et contient le textarea (Svelte est réactif, timeout 1s)
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    
    // Envoyer un message avec une demande de réponse spécifique pour vérifier la réponse
    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);
    
    // Attendre que le message utilisateur apparaisse dans la liste (fond sombre, aligné à droite)
    // Svelte est réactif, le message apparaît immédiatement (timeout 1s)
    const userGroup = page.locator('div.flex.flex-col.items-end.group').last();
    const userMessage = userGroup.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 5000 });
    
    // Le placeholder assistant (StreamMessage) est ajouté immédiatement après l'envoi.
    await expect.poll(async () => await assistantWrapper(page).count(), { timeout: 10_000 }).toBeGreaterThan(0);

    // Attendre qu'une réponse de l'assistant apparaisse avec le texte spécifique demandé
    // On cherche directement le texte "OK" dans le dernier message assistant qui le contient
    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
  });

  test('devrait envoyer le bon contexte primaire au backend selon la route', async ({ page }) => {
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');

    // 1) /folders → no contextId (expect no primaryContextType)
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 5000 });
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    const r1 = await sendMessageAndWaitApi(page, composer, 'Test context dossiers');
    expect(r1.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r1.requestBody?.primaryContextId ?? null).toBeNull();

    // 2) /organizations → no contextId (expect no primaryContextType)
    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Organisations', { timeout: 5000 });
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    const r2 = await sendMessageAndWaitApi(page, composer, 'Test context organisations');
    expect(r2.requestBody?.primaryContextType ?? null).toBeNull();
    expect(r2.requestBody?.primaryContextId ?? null).toBeNull();

    // 2bis) /organizations/[id] → organization + id from URL
    // Click the first organization row/card to navigate to detail.
    // Close the chat panel first to avoid intercepting clicks on the underlying cards.
    const closeButton = page.locator('button[aria-label="Fermer"]');
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await expect(composer).not.toBeVisible({ timeout: 5000 });
    }
    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) > 0) {
      await organizationRows.first().click();
      await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
      await page.waitForLoadState('domcontentloaded');
      const m = page.url().match(/\/organizations\/([^/?#]+)/);
      const organizationId = m ? m[1] : '';
      expect(organizationId).toBeTruthy();

      await expect(chatButton).toBeVisible({ timeout: 5000 });
      await chatButton.click();
      await expect(composer).toBeVisible({ timeout: 5000 });
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
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    const r3 = await sendMessageAndWaitApi(page, composer, 'Test context usecase detail');
    expect(r3.requestBody?.primaryContextType).toBe('usecase');
    expect(r3.requestBody?.primaryContextId).toBe(useCaseId);
  });

  test('devrait gérer les contextes provisoires et persistants', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    const menuButton = page.locator('button[aria-label="Ouvrir le menu"]');

    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Organisations', { timeout: 5000 });

    const organizationRows = page.locator('article.rounded.border.border-slate-200');
    if ((await organizationRows.count()) === 0) return;
    await organizationRows.first().click();
    await page.waitForURL(/\/organizations\/[^/?#]+$/, { timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded');
    const orgName = (await page.locator('h1').first().textContent())?.trim();
    if (!orgName) return;

    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await menuButton.click();
    const menu = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    await expect(menu.locator('button', { hasText: orgName })).toBeVisible({ timeout: 5000 });
    const webSearchButton = menu.locator('button', { hasText: 'Web search' });
    const webSearchIcon = webSearchButton.locator('svg');
    const wasEnabled = await webSearchIcon.evaluate((el) => el.classList.contains('text-slate-900'));
    await webSearchButton.click();
    await expect(webSearchIcon).toHaveClass(wasEnabled ? /text-slate-400/ : /text-slate-900/);

    // Quitter la vue sans envoyer de message: contexte provisoire supprimé.
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 5000 });
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await menuButton.click();
    const menu2 = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
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
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await sendMessageAndWaitApi(page, composer, 'Contexte utilisé');

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    await expect(composer).toBeVisible({ timeout: 5000 });
    await menuButton.click();
    const menu3 = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    await expect(menu3.locator('button', { hasText: orgName })).toBeVisible({ timeout: 5000 });
  });

  test('devrait basculer entre Chat et Jobs IA dans le widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    
    // Attendre que le panneau soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    
    // Basculer vers Jobs via l'onglet
    const jobsTab = page.locator('button, [role="tab"]').filter({ hasText: /^Jobs(?: IA)?$/i }).first();
    await expect(jobsTab).toBeVisible({ timeout: 5000 });
    await jobsTab.click();
    
    // Vérifier que le panneau Jobs est visible (pas le chat)
    await expect(composer).not.toBeVisible({ timeout: 1000 });
    
    // Basculer de retour vers Chat
    const chatTab = page.locator('button, [role="tab"]').filter({ hasText: /^Chat(?: IA)?$/i }).first();
    await expect(chatTab).toBeVisible({ timeout: 5000 });
    await chatTab.click();
    
    // Vérifier que le panneau chat est de nouveau visible
    await expect(composer).toBeVisible({ timeout: 1000 });
  });

  test('devrait maintenir la conversation avec plusieurs messages', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
    
    // Envoyer un premier message (objectif du test: la conversation est conservée, pas la sémantique exacte)
    const message1 = `Réponds brièvement (test E2E)`;
    await sendMessageAndWaitApi(page, composer, message1);
    
    // Attendre que le message utilisateur apparaisse
    const userMessage1 = page.locator('.userMarkdown').filter({ hasText: message1 }).first();
    await expect(userMessage1).toBeVisible({ timeout: 5000 });
    
    // Attendre qu'un message assistant apparaisse (placeholder streaming ou contenu final)
    const assistantWrappers = assistantWrapper(page);
    await expect.poll(async () => await assistantWrappers.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    
    // Envoyer un deuxième message dans la même session avec une autre réponse spécifique
    const message2 = `Deuxième message (test E2E)`;
    await sendMessageAndWaitApi(page, composer, message2);
    
    // Vérifier que les deux messages utilisateur sont visibles
    const userMessage2 = page.locator('.userMarkdown').filter({ hasText: message2 }).first();
    await expect(userMessage2).toBeVisible({ timeout: 5000 });
    
    // Le point clé: le 2e message n'a pas effacé le 1er (session/conversation conservée)
    await expect(userMessage1).toBeVisible({ timeout: 5_000 });

    // Attendre qu'au moins un message assistant soit visible après le 2e envoi
    await expect.poll(async () => await assistantWrappers.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('devrait gérer les actions sur les messages (copier, éditer, retry, feedback)', async ({ page }) => {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });

    const expectedResponse = 'OK';
    const message = `Réponds uniquement avec le mot ${expectedResponse}`;
    const { jobId, streamId } = await sendMessageAndWaitApi(page, composer, message);

    const userGroup = page.locator('div.flex.flex-col.items-end.group').last();
    const userMessage = userGroup.locator('.userMarkdown').filter({ hasText: message }).first();
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    const assistantResponse = assistantBubble(page).filter({ hasText: expectedResponse }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }

    await userGroup.hover();
    await userGroup.locator('button[aria-label="Copier"]').click();

    await userGroup.locator('button[aria-label="Modifier"]').click({ force: true });
    const editInput = userGroup.locator('[contenteditable="true"]').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });
    await editInput.click();
    await page.keyboard.press('Control+A');
    const updatedMessage = 'Message modifié (E2E)';
    await page.keyboard.type(updatedMessage);
    const saveButton = userGroup.locator('button', { hasText: 'Envoyer' });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();
    await expect(page.locator('.userMarkdown').filter({ hasText: updatedMessage }).first()).toBeVisible({ timeout: 5000 });

    const assistantGroup = assistantWrapper(page).last();
    const usefulButton = assistantGroup.locator('button[aria-label="Utile"]');
    await usefulButton.click();
    await expect(usefulButton).toHaveClass(/text-slate-900/);
    await usefulButton.click();
    await expect(usefulButton).not.toHaveClass(/text-slate-900/);

    const retryButton = assistantGroup.locator('button[aria-label="Réessayer"]');
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
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();

    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });

    await sendMessageAndWaitApi(page, composer, 'Donne un titre court à cette conversation.');

    const sessionMenuButton = page.locator('button[aria-label="Choisir une conversation"]');
    await expect(sessionMenuButton).toBeVisible({ timeout: 5000 });
    await sessionMenuButton.click();
    const sessionMenu = page.locator('div').filter({ hasText: 'Nouvelle session' }).first();
    await expect(sessionMenu).toBeVisible({ timeout: 5000 });

    const selectedSession = sessionMenu.locator('button.font-semibold').first();
    await expect.poll(async () => {
      const text = (await selectedSession.textContent())?.trim() ?? '';
      return text;
    }, { timeout: 90_000 }).not.toMatch(/^Conversation\s/);
  });

  test('devrait permettre upload + résumé + usage tool + suppression en viewer', async ({ browser }) => {
    const adminApi = await request.newContext({ baseURL: API_BASE_URL, storageState: ADMIN_STATE });
    const workspacesRes = await adminApi.get('/api/v1/workspaces');
    expect(workspacesRes.ok()).toBeTruthy();
    const workspacesData = await workspacesRes.json().catch(() => null);
    const adminWorkspace = (workspacesData?.items ?? []).find((w: { name?: string }) => w.name === 'Admin Workspace');
    const adminWorkspaceId = String(adminWorkspace?.id ?? '');
    expect(adminWorkspaceId).toBeTruthy();

    const addMemberRes = await adminApi.post(`/api/v1/workspaces/${adminWorkspaceId}/members`, {
      data: { email: USER_A_EMAIL, role: 'viewer' }
    });
    expect(addMemberRes.ok()).toBeTruthy();
    await adminApi.dispose();

    const userContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, adminWorkspaceId),
    });
    const page = await userContext.newPage();

    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 5000 });

    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 5000 });
    await chatButton.click();
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });

    const menuButton = page.locator('button[aria-label="Ouvrir le menu"]');
    await menuButton.click();
    const menu = page.locator('div.absolute').filter({ hasText: 'Contexte(s)' }).first();
    const fileInput = menu.locator('input[type="file"]');
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/README.md');
    await fileInput.setInputFiles(fixturePath);
    await expect(page.locator('div.absolute').filter({ hasText: 'Contexte(s)' })).toHaveCount(0);

    const docRow = page
      .locator('div', { hasText: 'README.md' })
      .filter({ has: page.locator('button[aria-label="Supprimer le document"]') })
      .first();
    await expect(docRow).toBeVisible({ timeout: 15_000 });
    await expect(docRow).toContainText(/En attente|Analyse en cours|Résumé prêt/);
    await expect(docRow).toContainText('Résumé prêt', { timeout: 90_000 });

    const { jobId, streamId } = await sendMessageAndWaitApi(
      page,
      composer,
      'Liste les documents de la session et cite leur nom.'
    );
    const assistantResponse = assistantBubble(page).filter({ hasText: 'README.md' }).last();
    try {
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }

    await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'DELETE' && res.url().includes('/api/v1/documents/');
      }, { timeout: 30_000 }),
      docRow.locator('button[aria-label="Supprimer le document"]').click()
    ]);
    await expect(docRow).toHaveCount(0);

    await userContext.close();
  });

  test('devrait conserver la session après fermeture et réouverture du widget', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
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
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
    await expect(chatButton).toBeVisible({ timeout: 1000 });
    await chatButton.click();
    
    // Attendre que le panneau chat soit visible
    const composer = page.locator('[role="textbox"][aria-label="Composer"]');
    await expect(composer).toBeVisible({ timeout: 1000 });
    
    // Envoyer un message pour créer une session avec une réponse spécifique
    // On demande explicitement de ne PAS utiliser d'outils
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
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
    
    // Vérifier que le menu de sessions contient maintenant au moins une conversation
    const sessionMenuButton = page.locator('button[aria-label="Choisir une conversation"]');
    await expect(sessionMenuButton).toBeVisible({ timeout: 5000 });
    await sessionMenuButton.click();
    const sessionMenu = page.locator('div').filter({ hasText: 'Nouvelle session' }).first();
    await expect(sessionMenu).toBeVisible({ timeout: 5000 });
    const sessionItems = sessionMenu.locator('div.max-h-48 button');
    expect(await sessionItems.count()).toBeGreaterThanOrEqual(1);
  });

  test('devrait supprimer une session', async ({ page }) => {
    // Aller sur une page simple
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('Dossiers', { timeout: 1000 });
    
    // Ouvrir le ChatWidget
    const chatButton = page.locator('button[title="Chat / Jobs"], button[title="Chat / Jobs IA"], button[aria-label="Chat / Jobs"], button[aria-label="Chat / Jobs IA"]');
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
      await expect(assistantResponse).toBeVisible({ timeout: 90_000 });
    } catch (e) {
      await debugAssistantState(page);
      await debugBackendState(page, jobId, streamId);
      throw e;
    }
    
    // Vérifier qu'une session existe dans le menu
    const sessionMenuButton = page.locator('button[aria-label="Choisir une conversation"]');
    await expect(sessionMenuButton).toBeVisible({ timeout: 5000 });
    await sessionMenuButton.click();
    const sessionMenu = page.locator('div').filter({ hasText: 'Nouvelle session' }).first();
    await expect(sessionMenu).toBeVisible({ timeout: 5000 });
    const sessionItems = sessionMenu.locator('div.max-h-48 button');
    expect(await sessionItems.count()).toBeGreaterThanOrEqual(1);
    
    // Cliquer sur le bouton de suppression (icône poubelle)
    const deleteButton = page.locator('button[title="Supprimer la conversation"]');
    await expect(deleteButton).toBeVisible({ timeout: 1000 });
    
    // Configurer le handler pour le dialogue de confirmation
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('confirm');
      dialog.accept();
    });
    
    // Déclencher la suppression et attendre un signal déterministe côté API
    await Promise.all([
      page.waitForResponse((res) => {
        const req = res.request();
        return req.method() === 'DELETE' && res.url().includes('/api/v1/chat/sessions/');
      }, { timeout: 15_000 }),
      deleteButton.click()
    ]);

    // Attendre que l'UI revienne à l'état "nouvelle session" (messages vides)
    await expect(page.getByText('Aucun message. Écris un message pour démarrer.')).toBeVisible({ timeout: 15_000 });
    
    // Vérifier que le menu est revenu à "Aucune conversation"
    await sessionMenuButton.click();
    const emptyLabel = page.locator('div').filter({ hasText: 'Aucune conversation' }).first();
    await expect(emptyLabel).toBeVisible({ timeout: 5000 });
  });

});
