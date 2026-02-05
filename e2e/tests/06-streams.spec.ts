import { test, expect, request } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Streams — SSE scoping', () => {
  const FILE_TAG = 'e2e:streams.spec.ts';
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAId = '';
  let workspaceBId = '';
  let organizationAId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    const userBApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_B_STATE,
    });

    // Créer deux workspaces uniques pour ce fichier de test (isolation des ressources)
    // Workspace A pour User A
    const workspaceAName = `Streams Workspace A E2E ${Date.now()}`;
    const createARes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceAName } });
    if (!createARes.ok()) throw new Error(`Impossible de créer workspace A (status ${createARes.status()})`);
    const createdA = await createARes.json().catch(() => null);
    workspaceAId = String(createdA?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Workspace B pour User B
    const workspaceBName = `Streams Workspace B E2E ${Date.now()}`;
    const createBRes = await userBApi.post('/api/v1/workspaces', { data: { name: workspaceBName } });
    if (!createBRes.ok()) throw new Error(`Impossible de créer workspace B (status ${createBRes.status()})`);
    const createdB = await createBRes.json().catch(() => null);
    workspaceBId = String(createdB?.id || '');
    if (!workspaceBId) throw new Error('workspaceBId introuvable');

    // Créer une organisation dans Workspace A pour les tests
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    organizationAId = String(orgJson?.id || '');
    if (!organizationAId) throw new Error('organizationAId introuvable');

    await userAApi.dispose();
    await userBApi.dispose();
  });

  test('SSE: aucun leak cross-workspace', async ({ browser }, testInfo) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    const userAContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
    });
    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceBId),
    });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    const initSse = async (page: typeof pageA, workspaceId: string) => {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate((id) => {
        (window as any).__events = [];
        (window as any).__sseReady = false;
        const es = new EventSource(`/api/v1/streams/sse?workspace_id=${id}`);
        es.addEventListener('open', () => {
          (window as any).__sseReady = true;
        });
        es.addEventListener('organization_update', (evt) => {
          (window as any).__events.push({ type: 'organization_update', data: (evt as MessageEvent).data });
        });
        (window as any).__eventSource = es;
      }, workspaceId);
      await page.waitForFunction(() => (window as any).__sseReady === true, { timeout: 10_000 });
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
    await userAContext.close();
    await userBContext.close();
    await userAApi.dispose();
  });

  test('Stream events restent accessibles après retry', async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const workspacesRes = await userAApi.get('/api/v1/workspaces');
    expect(workspacesRes.ok()).toBeTruthy();
    const workspacesData = await workspacesRes.json().catch(() => null);
    const workspaceId = String((workspacesData?.items ?? [])[0]?.id ?? '');
    if (!workspaceId) throw new Error('workspaceId introuvable pour user A');

    const createMessageRes = await userAApi.post(`/api/v1/chat/messages?workspace_id=${workspaceId}`, {
      data: { content: 'Test stream retry E2E' },
    });
    expect(createMessageRes.ok()).toBeTruthy();
    const createPayload = await createMessageRes.json().catch(() => null);
    const userMessageId = String(createPayload?.userMessageId ?? '');
    const streamId = String(createPayload?.streamId ?? '');
    if (!userMessageId || !streamId) throw new Error('Message/stream manquant');

    await expect
      .poll(async () => {
        const eventsRes = await userAApi.get(`/api/v1/streams/events/${encodeURIComponent(streamId)}?limit=50`);
        if (!eventsRes.ok()) return 0;
        const payload = await eventsRes.json().catch(() => null);
        return Array.isArray(payload?.events) ? payload.events.length : 0;
      }, { timeout: 60_000 })
      .toBeGreaterThan(0);

    const retryRes = await userAApi.post(
      `/api/v1/chat/messages/${encodeURIComponent(userMessageId)}/retry?workspace_id=${workspaceId}`
    );
    expect(retryRes.ok()).toBeTruthy();
    const retryPayload = await retryRes.json().catch(() => null);
    const retryStreamId = String(retryPayload?.streamId ?? '');
    if (!retryStreamId) throw new Error('streamId retry manquant');

    await expect
      .poll(async () => {
        const eventsRes = await userAApi.get(`/api/v1/streams/events/${encodeURIComponent(retryStreamId)}?limit=50`);
        if (!eventsRes.ok()) return 0;
        const payload = await eventsRes.json().catch(() => null);
        return Array.isArray(payload?.events) ? payload.events.length : 0;
      }, { timeout: 60_000 })
      .toBeGreaterThan(0);

    await userAApi.dispose();
  });
});
