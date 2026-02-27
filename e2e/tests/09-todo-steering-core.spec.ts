import { expect, test } from '@playwright/test';

type WorkspaceItem = {
  id: string;
  role?: string | null;
};

test.describe.serial('TODO steering core', () => {
  test('executes a workspace-scoped plan -> todo -> task -> steer flow', async ({
    page,
  }) => {
    const workspacesRes = await page.request.get('/api/v1/workspaces');
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

    const createPlanRes = await page.request.post(
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

    const createTodoRes = await page.request.post(
      `/api/v1/plans/${encodeURIComponent(planId)}/todos?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          title: `E2E TODO ${suffix}`,
          description: 'Created from e2e todo steering core spec',
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

    const createTaskRes = await page.request.post(
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

    const startRes = await page.request.post(
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

    const steerRes = await page.request.post(
      `/api/v1/runs/${encodeURIComponent(runId)}/steer?workspace_id=${encodeURIComponent(workspaceId)}`,
      {
        data: {
          message: 'Refocus on TODO completion criteria',
        },
      },
    );
    expect(steerRes.status()).toBe(200);

    const completeRes = await page.request.post(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/complete?workspace_id=${encodeURIComponent(workspaceId)}`,
      { data: {} },
    );
    expect(completeRes.status()).toBe(200);
    const completeBody = (await completeRes.json()) as {
      task?: { status?: string };
    };
    expect(completeBody.task?.status).toBe('done');
  });
});
