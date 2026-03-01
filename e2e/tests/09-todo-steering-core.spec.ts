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
      const steerMessage = 'Refocus on TODO completion criteria from steer panel';

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
      const taskId = String(createTaskBody.task?.id ?? '');
      expect(taskId).toBeTruthy();
      expect(createTaskBody.task?.status).toBe('planned');

      const startRes = await api.post(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/start?workspace_id=${encodeURIComponent(workspaceId)}`,
        { data: {} },
      );
      expect(startRes.status()).toBe(200);
      const startBody = (await startRes.json()) as {
        runId?: string;
        task?: { status?: string };
      };
      const runId = String(startBody.runId ?? '');
      expect(runId).toBeTruthy();
      expect(startBody.task?.status).toBe('in_progress');
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
      await composerEditable.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(steerMessage);
      const steerSubmit = page.getByTestId('chat-composer-steer-button');
      await expect(steerSubmit).toBeEnabled({ timeout: 15_000 });

      const [steerReq, steerRes] = await Promise.all([
        page.waitForRequest((req) => {
          return (
            req.method() === 'POST' &&
            req.url().includes('/api/v1/runs/') &&
            req.url().includes('/steer')
          );
        }),
        page.waitForResponse((res) => {
          const req = res.request();
          return (
            req.method() === 'POST' &&
            res.url().includes('/api/v1/runs/') &&
            res.url().includes('/steer')
          );
        }),
        steerSubmit.click(),
      ]);

      const steerBody = JSON.parse(steerReq.postData() || '{}') as {
        message?: string;
      };
      const steeredRunId =
        /\/api\/v1\/runs\/([^/]+)\/steer/.exec(steerReq.url())?.[1] ?? '';
      expect(steerBody.message).toBe(steerMessage);
      expect(steeredRunId).toBeTruthy();
      expect(steerRes.status()).toBe(200);
      await expect(page.locator('#chat-widget-dialog')).toContainText(
        /Prise en compte d'un nouveau message utilisateur|Acknowledged new user steering message/i,
      );
      await expect(page.locator('#chat-widget-dialog')).toContainText(steerMessage);

      const completeRes = await api.post(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/complete?workspace_id=${encodeURIComponent(workspaceId)}`,
        { data: {} },
      );
      expect(completeRes.status()).toBe(200);
      const completeBody = (await completeRes.json()) as {
        task?: { status?: string };
      };
      expect(completeBody.task?.status).toBe('done');
    } finally {
      await api.dispose();
    }
  });
});
