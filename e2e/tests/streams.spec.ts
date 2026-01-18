import { test, expect, request } from '@playwright/test';

test.describe('Streams — SSE scoping', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAId = '';
  let workspaceBId = '';
  let organizationAId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });

    const workspacesARes = await userAApi.get('/api/v1/workspaces');
    expect(workspacesARes.ok()).toBeTruthy();
    const workspacesAJson = await workspacesARes.json().catch(() => null);
    const workspacesA: Array<{ id: string; name: string }> = workspacesAJson?.items ?? [];
    const workspaceA = workspacesA.find((ws) => ws.name.includes('Workspace A (E2E)'));
    if (!workspaceA) throw new Error('Workspace A (E2E) introuvable');
    workspaceAId = workspaceA.id;

    const workspacesBRes = await userBApi.get('/api/v1/workspaces');
    expect(workspacesBRes.ok()).toBeTruthy();
    const workspacesBJson = await workspacesBRes.json().catch(() => null);
    const workspacesB: Array<{ id: string; name: string }> = workspacesBJson?.items ?? [];
    const workspaceB = workspacesB.find((ws) => ws.name.includes('Workspace B (E2E)'));
    if (!workspaceB) throw new Error('Workspace B (E2E) introuvable');
    workspaceBId = workspaceB.id;

    const orgsRes = await userAApi.get('/api/v1/organizations');
    if (!orgsRes.ok()) throw new Error(`Impossible de charger les organisations (status ${orgsRes.status()})`);
    const orgsJson = await orgsRes.json().catch(() => null);
    const orgItems: Array<{ id: string }> = orgsJson?.items ?? [];
    if (!orgItems.length) throw new Error('Aucune organisation Workspace A');
    organizationAId = orgItems[0].id;

    await userAApi.dispose();
    await userBApi.dispose();
  });

  test('SSE: aucun leak cross-workspace', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const pageA = await (await browser.newContext({ storageState: USER_A_STATE })).newPage();
    const pageB = await (await browser.newContext({ storageState: USER_B_STATE })).newPage();

    const initSse = async (page: typeof pageA, workspaceId: string) => {
      await page.addInitScript((id: string) => {
        try {
          localStorage.setItem('workspaceScopeId', id);
        } catch {
          // ignore
        }
      }, workspaceId);
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate((id) => {
        (window as any).__events = [];
        const es = new EventSource(`/api/v1/streams/sse?workspace_id=${id}`);
        es.addEventListener('organization_update', (evt) => {
          (window as any).__events.push({ type: 'organization_update', data: (evt as MessageEvent).data });
        });
        (window as any).__eventSource = es;
      }, workspaceId);
    };

    await initSse(pageA, workspaceAId);
    await initSse(pageB, workspaceBId);

    const newName = `Pomerleau SSE ${Date.now()}`;
    const updateRes = await userAApi.put(`/api/v1/organizations/${organizationAId}?workspace_id=${workspaceAId}`, {
      data: { name: newName },
    });
    expect(updateRes.ok()).toBeTruthy();

    await expect
      .poll(async () => {
        return pageA.evaluate(() => {
          const events = (window as any).__events || [];
          return events.filter((evt: { type: string }) => evt.type === 'organization_update').length;
        });
      }, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await pageB.waitForTimeout(2000);
    const leaked = await pageB.evaluate(() => {
      const events = (window as any).__events || [];
      return events.some((evt: { type: string }) => evt.type === 'organization_update');
    });
    expect(leaked).toBeFalsy();

    await pageA.evaluate(() => (window as any).__eventSource?.close?.());
    await pageB.evaluate(() => (window as any).__eventSource?.close?.());
    await pageA.context().close();
    await pageB.context().close();
    await userAApi.dispose();
  });
});
