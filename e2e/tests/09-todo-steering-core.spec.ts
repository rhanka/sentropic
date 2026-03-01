import { expect, request, test } from '@playwright/test';

type WorkspaceItem = {
  id: string;
  role?: string | null;
};

test.describe.serial('TODO steering core', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const DEFAULT_AUTH_STATE = './.auth/state.json';

  test('executes a workspace-scoped plan -> todo -> task -> steer flow via steer UI', async ({
    page,
  }) => {
    const api = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: DEFAULT_AUTH_STATE,
    });

    try {
      const workspacesRes = await api.get('/api/v1/workspaces');
      expect(workspacesRes.ok()).toBeTruthy();
      const workspacesPayload = (await workspacesRes.json().catch(() => null)) as
        | { items?: WorkspaceItem[] }
        | null;
      const items = Array.isArray(workspacesPayload?.items)
        ? workspacesPayload.items
        : [];
      const writableWorkspace =
        items.find((entry) => entry.role !== 'viewer') ?? items[0];
      expect(writableWorkspace?.id).toBeTruthy();
      const workspaceId = String(writableWorkspace?.id ?? '');

      const suffix = Date.now();
      const sessionTitle = `E2E steer UI ${suffix}`;
      const initialMessage =
        "Rédige 180 lignes numérotées sur l'analyse de la maintenance prédictive ferroviaire pour Bombardier Inc., avec exemples concrets, contraintes RGPD, cybersécurité OT, budget de 1M$ et délai de 6 mois. Ne pose aucune question et n'ajoute pas de résumé.";
      const steerMessage =
        'Concentre la suite sur les 3 points les plus prioritaires.';

      const sessionsRes = await api.get(
        `/api/v1/chat/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      expect(sessionsRes.ok()).toBeTruthy();
      const sessionsPayload = (await sessionsRes
        .json()
        .catch(() => null)) as
        | { sessions?: Array<{ id?: string }> }
        | null;
      for (const session of sessionsPayload?.sessions ?? []) {
        const sessionId = String(session?.id ?? '').trim();
        if (!sessionId) continue;
        const deleteRes = await api.delete(
          `/api/v1/chat/sessions/${encodeURIComponent(sessionId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        );
        expect(deleteRes.ok()).toBeTruthy();
      }

      const createSessionRes = await api.post(
        `/api/v1/chat/sessions?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            primaryContextType: 'folder',
            sessionTitle,
          },
        },
      );
      expect(createSessionRes.status()).toBe(200);
      const createSessionBody = (await createSessionRes.json()) as {
        sessionId?: string;
      };
      const sessionId = String(createSessionBody.sessionId ?? '');
      expect(sessionId).toBeTruthy();

      const createPlanRes = await api.post(
        `/api/v1/plans?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            title: `E2E TODO plan ${suffix}`,
            description: 'Minimal BR03 todo steering validation',
          },
        },
      );
      expect(createPlanRes.status()).toBe(201);
      const createPlanBody = (await createPlanRes.json()) as {
        plan?: { id?: string; derivedStatus?: string };
      };
      const planId = String(createPlanBody.plan?.id ?? '');
      expect(planId).toBeTruthy();
      expect(createPlanBody.plan?.derivedStatus).toBe('todo');

      const createTodoRes = await api.post(
        `/api/v1/plans/${encodeURIComponent(planId)}/todos?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            title: `E2E TODO ${suffix}`,
            description: 'Created from e2e todo steering core spec',
            sessionId,
          },
        },
      );
      expect(createTodoRes.status()).toBe(201);
      const createTodoBody = (await createTodoRes.json()) as {
        todo?: { id?: string; planId?: string; derivedStatus?: string };
      };
      const todoId = String(createTodoBody.todo?.id ?? '');
      expect(todoId).toBeTruthy();
      expect(createTodoBody.todo?.planId).toBe(planId);
      expect(createTodoBody.todo?.derivedStatus).toBe('todo');

      const createTaskRes = await api.post(
        `/api/v1/todos/${encodeURIComponent(todoId)}/tasks?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            title: `E2E task ${suffix}`,
            status: 'planned',
          },
        },
      );
      expect(createTaskRes.status()).toBe(201);
      const createTaskBody = (await createTaskRes.json()) as {
        task?: { id?: string; status?: string };
      };
      expect(String(createTaskBody.task?.id ?? '')).toBeTruthy();
      expect(createTaskBody.task?.status).toBe('planned');
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
      await expect(chatButton).toBeVisible({ timeout: 15_000 });
      await chatButton.click();

      const composer = page.locator('[role="textbox"][aria-label="Composer"]');
      await expect(composer).toBeVisible();
      const composerEditable = page
        .locator(
          '[role="textbox"][aria-label="Composer"][contenteditable="true"]:visible, [role="textbox"][aria-label="Composer"]:visible [contenteditable="true"]:visible',
        )
        .first();
      await expect(composerEditable).toBeVisible();

      const sessionHeader = page
        .locator('#chat-widget-dialog div.border-b div.min-w-0.text-xs.text-slate-500.truncate')
        .first();
      await expect(sessionHeader).toContainText(sessionTitle);

      const runtimePanel = page.getByTestId('todo-runtime-panel');
      await expect(runtimePanel).toBeVisible();

      // Keep plan/todo/task coverage from API setup, but close the TODO before
      // steering assertions to avoid forced TODO-progression short responses.
      const closeTodoRes = await api.patch(
        `/api/v1/todos/${encodeURIComponent(todoId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            closed: true,
          },
        },
      );
      expect(closeTodoRes.status()).toBe(200);

      const aiSettingsRes = await api.put('/api/v1/ai-settings', {
        data: {
          processingInterval: 10000,
        },
      });
      expect(aiSettingsRes.status()).toBe(200);

      const modelSelect = page.locator('#chat-widget-dialog select').last();
      await expect(modelSelect).toBeVisible();
      const gpt52OptionValue = await modelSelect.evaluate((node) => {
        const select = node as HTMLSelectElement;
        const option = Array.from(select.options).find((item) =>
          item.text.includes('GPT-5.2'),
        );
        return option?.value ?? null;
      });
      if (gpt52OptionValue) {
        await modelSelect.selectOption(gpt52OptionValue);
      }

      const isChatMessageRequestFor = (
        req: { method(): string; url(): string; postDataJSON(): unknown },
        expectedContent: string,
      ): boolean => {
        if (
          req.method() !== 'POST' ||
          !req.url().includes('/api/v1/chat/messages')
        ) {
          return false;
        }
        try {
          const payload = req.postDataJSON() as { content?: string };
          return payload?.content === expectedContent;
        } catch {
          return false;
        }
      };

      await composerEditable.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(initialMessage);
      const sendButton = page.getByTestId('chat-composer-send-button');
      await expect(sendButton).toBeEnabled({ timeout: 15_000 });
      await Promise.all([
        page.waitForRequest((req) => isChatMessageRequestFor(req, initialMessage)),
        sendButton.click(),
      ]);

      const stopButton = page.locator('button[aria-label="Stopper"]');
      await expect(stopButton).toBeVisible({ timeout: 12_000 });

      let legacyRunSteerCalled = false;
      const onRequest = (req: { method(): string; url(): string }) => {
        if (
          req.method() === 'POST' &&
          req.url().includes('/api/v1/runs/') &&
          req.url().includes('/steer')
        ) {
          legacyRunSteerCalled = true;
        }
      };
      page.on('request', onRequest);

      await composerEditable.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(steerMessage);
      const composerSubmit = page
        .locator(
          '[data-testid="chat-composer-steer-button"], [data-testid="chat-composer-send-button"]',
        )
        .last();
      await expect(composerSubmit).toBeVisible();
      const [steerReq, steerRes] = await Promise.all([
        page.waitForRequest((req) => {
          return isChatMessageRequestFor(req, steerMessage);
        }),
        page.waitForResponse((res) => {
          const req = res.request();
          return isChatMessageRequestFor(req, steerMessage);
        }),
        composerSubmit.click(),
      ]);
      page.off('request', onRequest);
      const steerBody = steerReq.postDataJSON() as {
        content?: string;
        sessionId?: string;
      };
      expect(steerBody.content).toBe(steerMessage);
      expect(steerBody.sessionId).toBe(sessionId);
      expect(steerRes.status()).toBe(200);
      expect(legacyRunSteerCalled).toBe(false);
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        /Prise en compte d'un nouveau message utilisateur|Acknowledged new user steering message/i,
      );
      await expect(page.locator('#chat-widget-dialog')).toContainText(steerMessage);
    } finally {
      await api.dispose();
    }
  });
});
