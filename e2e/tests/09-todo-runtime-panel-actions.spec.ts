import { expect, request, test } from '@playwright/test';

test.describe('TODO runtime panel actions over clean workflow paths', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const DEFAULT_AUTH_STATE = './.auth/state.json';

  test('supports chevron toggle style and trash close action', async ({ page }) => {
    const api = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: DEFAULT_AUTH_STATE,
    });

    try {
      const suffix = Date.now();
      const workspaceRes = await api.post('/api/v1/workspaces', {
        data: { name: `E2E TODO panel ${suffix}` },
      });
      expect(workspaceRes.ok()).toBeTruthy();
      const workspaceId = String((await workspaceRes.json().catch(() => null))?.id ?? '');
      expect(workspaceId).toBeTruthy();
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

      await page.addInitScript((id) => localStorage.setItem('workspaceScopeId', id), workspaceId);
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

      await deleteButton.click();
      const confirmDeleteButton = runtimePanel.getByRole('button', {
        name: /Supprimer|Delete/i,
      });
      await expect(confirmDeleteButton).toBeVisible();
      await confirmDeleteButton.click();

      await expect(runtimePanel).toBeHidden({ timeout: 10_000 });
    } finally {
      await api.dispose();
    }
  });
});
