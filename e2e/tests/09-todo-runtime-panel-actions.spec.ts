import { expect, request, test } from '@playwright/test';

type WorkspaceItem = {
  id: string;
  role?: string | null;
};

test.describe('TODO runtime panel actions', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const DEFAULT_AUTH_STATE = './.auth/state.json';

  test('supports chevron toggle style and trash close action', async ({ page }) => {
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

      const suffix = Date.now();
      const sessionTitle = `E2E TODO panel actions ${suffix}`;
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
            title: `E2E panel plan ${suffix}`,
          },
        },
      );
      expect(createPlanRes.status()).toBe(201);
      const createPlanBody = (await createPlanRes.json()) as {
        plan?: { id?: string };
      };
      const planId = String(createPlanBody.plan?.id ?? '');
      expect(planId).toBeTruthy();

      const createTodoRes = await api.post(
        `/api/v1/plans/${encodeURIComponent(planId)}/todos?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            title: `TODO actions ${suffix}`,
            sessionId,
          },
        },
      );
      expect(createTodoRes.status()).toBe(201);
      const createTodoBody = (await createTodoRes.json()) as {
        todo?: { id?: string };
      };
      const todoId = String(createTodoBody.todo?.id ?? '');
      expect(todoId).toBeTruthy();

      const taskTitle = `Toggle/trash task ${suffix}`;
      const createTaskRes = await api.post(
        `/api/v1/todos/${encodeURIComponent(todoId)}/tasks?workspace_id=${encodeURIComponent(workspaceId)}`,
        {
          data: {
            title: taskTitle,
            status: 'planned',
          },
        },
      );
      expect(createTaskRes.status()).toBe(201);

      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const chatButton = page.locator('button[aria-controls="chat-widget-dialog"]');
      await expect(chatButton).toBeVisible({ timeout: 15_000 });
      await chatButton.click();

      const runtimePanel = page.getByTestId('todo-runtime-panel');
      await expect(runtimePanel).toBeVisible();

      const toggleButton = page.getByTestId('todo-runtime-toggle-button');
      const deleteButton = page.getByTestId('todo-runtime-delete-button');
      await expect(toggleButton).toBeVisible();
      await expect(deleteButton).toBeVisible();

      const toggleClasses = await toggleButton.getAttribute('class');
      const deleteClasses = await deleteButton.getAttribute('class');
      expect(toggleClasses ?? '').toContain('hover:bg-slate-100');
      expect(toggleClasses ?? '').toContain('rounded');
      expect(deleteClasses ?? '').toContain('hover:bg-red-50');
      expect(deleteClasses ?? '').toContain('rounded');

      const taskRow = runtimePanel.locator('li', { hasText: taskTitle });
      await expect(taskRow).toBeVisible();

      await toggleButton.click();
      await expect(taskRow).toBeHidden();
      await toggleButton.click();
      await expect(taskRow).toBeVisible();

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });
      await deleteButton.click();

      await expect(runtimePanel).toBeHidden({ timeout: 10_000 });
    } finally {
      await api.dispose();
    }
  });
});
