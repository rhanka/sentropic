import { test, expect, request } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
const USER_A_STATE = './.auth/user-a.json';
const USER_B_STATE = './.auth/user-b.json';
const FILE_TAG = 'e2e:tenancy-workspaces.spec.ts';
const WORKSPACE_A_ID = 'e2e-ws-a';
const WORKSPACE_B_ID = 'e2e-ws-b';


test.describe.serial('Tenancy / cloisonnement workspace', () => {

  test.describe('Workspace A', () => {
    test('ne devrait pas voir les données du workspace B', async ({ browser }) => {
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, WORKSPACE_A_ID),
      });
      const page = await userAContext.newPage();
      await page.goto('/organizations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });
      await expect(page.locator('body')).toContainText('Pomerleau', { timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText('Groupe BMR', { timeout: 15_000 });
      await userAContext.close();
    });
  });

  test.describe('Workspace B', () => {
    test('ne devrait pas voir les données du workspace A', async ({ browser }) => {
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, WORKSPACE_B_ID),
      });
      const page = await userBContext.newPage();
      await page.goto('/organizations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });
      await expect(page.locator('body')).toContainText('Groupe BMR', { timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText('Pomerleau', { timeout: 15_000 });
      await userBContext.close();
    });
  });

  test('User A crée workspace + assigne rôles (viewer → editor → admin)', async ({ browser }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    const workspaceName = `Workspace Alpha ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer Workspace Alpha (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    const workspaceId = String(created?.id || '');
    if (!workspaceId) throw new Error('workspaceId introuvable');

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b viewer (status ${addRes.status()})`);
    }

    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const pageB = await userBContext.newPage();
    await pageB.goto('/settings');
    await pageB.waitForLoadState('domcontentloaded');
    const rowB = pageB.locator('tbody tr').filter({ hasText: workspaceName }).first();
    await expect(rowB).toBeVisible({ timeout: 10_000 });
    await rowB.click();
    const scopeId = await pageB.evaluate(() => localStorage.getItem('workspaceScopeId'));
    expect(scopeId).toBe(workspaceId);

    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceId}/members`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userB = members.find((m) => m.email === 'e2e-user-b@example.com');
    if (!userB?.userId) throw new Error('userBId introuvable');

    await userAApi.patch(`/api/v1/workspaces/${workspaceId}/members/${userB.userId}`, { data: { role: 'editor' } });
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await expect(pageB.locator('tbody tr').filter({ hasText: workspaceName }).locator('td').nth(2)).toHaveText(/editor|editeur|éditeur/i);

    await userAApi.patch(`/api/v1/workspaces/${workspaceId}/members/${userB.userId}`, { data: { role: 'admin' } });
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    const rowAdmin = pageB.locator('tbody tr').filter({ has: pageB.locator('.editable-input') }).first();
    await expect(rowAdmin.locator('.editable-input').first()).toHaveValue(workspaceName, { timeout: 10_000 });
    await expect(rowAdmin.locator('td').nth(2)).toHaveText(/admin/i);

    await userBContext.close();
    await userAApi.dispose();
  });

  test('autocomplete @ mention respecte le scope workspace', async ({ browser }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    const workspaceAName = `Workspace Mention A ${Date.now()}`;
    const workspaceBName = `Workspace Mention B ${Date.now()}`;

    const wsARes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceAName } });
    if (!wsARes.ok()) throw new Error(`Impossible de créer workspace A (${wsARes.status()})`);
    const wsAJson = await wsARes.json().catch(() => null);
    const wsAId = String(wsAJson?.id || '');

    const wsBRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceBName } });
    if (!wsBRes.ok()) throw new Error(`Impossible de créer workspace B (${wsBRes.status()})`);
    const wsBJson = await wsBRes.json().catch(() => null);
    const wsBId = String(wsBJson?.id || '');

    await userAApi.post(`/api/v1/workspaces/${wsAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'commenter' },
    });
    await userAApi.post(`/api/v1/workspaces/${wsBId}/members`, {
      data: { email: 'e2e-user-victim@example.com', role: 'commenter' },
    });

    const orgARes = await userAApi.post(`/api/v1/organizations?workspace_id=${wsAId}`, {
      data: { name: 'Org Mention A', status: 'completed' },
    });
    const orgAJson = await orgARes.json().catch(() => null);
    const folderARes = await userAApi.post(`/api/v1/folders?workspace_id=${wsAId}`, {
      data: { name: 'Dossier Mention A', organizationId: orgAJson?.id },
    });
    const folderAJson = await folderARes.json().catch(() => null);
    const useCaseARes = await userAApi.post(`/api/v1/use-cases?workspace_id=${wsAId}`, {
      data: { folderId: folderAJson?.id, name: 'Cas d\'usage Mention A' },
    });
    const useCaseAJson = await useCaseARes.json().catch(() => null);

    const orgBRes = await userAApi.post(`/api/v1/organizations?workspace_id=${wsBId}`, {
      data: { name: 'Org Mention B', status: 'completed' },
    });
    const orgBJson = await orgBRes.json().catch(() => null);
    const folderBRes = await userAApi.post(`/api/v1/folders?workspace_id=${wsBId}`, {
      data: { name: 'Dossier Mention B', organizationId: orgBJson?.id },
    });
    const folderBJson = await folderBRes.json().catch(() => null);
    const useCaseBRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${wsBId}`, {
      data: { folderId: folderBJson?.id, name: 'Cas d\'usage Mention B' },
    });
    const useCaseBJson = await useCaseBRes.json().catch(() => null);

    await userAApi.dispose();

    const wsAStorage = await withWorkspaceStorageState(USER_A_STATE, wsAId);
    const wsBStorage = await withWorkspaceStorageState(USER_A_STATE, wsBId);
    const wsAContext = await browser.newContext({ storageState: wsAStorage });
    const wsBContext = await browser.newContext({ storageState: wsBStorage });
    const pageA = await wsAContext.newPage();
    const pageB = await wsBContext.newPage();

    const openMentionMenu = async (page: typeof pageA, useCaseId: string) => {
      await page.goto(`/usecase/${encodeURIComponent(useCaseId)}`);
      await page.waitForLoadState('domcontentloaded');

      const section = page.locator('[data-comment-section="description"]');
      await section.hover();
      await section.locator('button[aria-label="Commentaires"]').click({ force: true });

      const widget = page.locator('#chat-widget-dialog');
      await expect(widget).toBeVisible({ timeout: 10_000 });
      await widget.getByRole('button', { name: 'Commentaires', exact: true }).click();

      const composer = widget.locator('[role="textbox"][aria-label="Composer"]:visible');
      const editable = composer.locator('[contenteditable="true"]');
      await editable.click();
      await page.keyboard.type('@');

      return widget;
    };

    const widgetA = await openMentionMenu(pageA, useCaseAJson?.id);
    await expect(widgetA.locator('button:has-text("e2e-user-b@example.com")')).toBeVisible({ timeout: 10_000 });
    await expect(widgetA.locator('button:has-text("e2e-user-victim@example.com")')).toHaveCount(0);

    const widgetB = await openMentionMenu(pageB, useCaseBJson?.id);
    await expect(widgetB.locator('button:has-text("e2e-user-victim@example.com")')).toBeVisible({ timeout: 10_000 });
    await expect(widgetB.locator('button:has-text("e2e-user-b@example.com")')).toHaveCount(0);

    await wsAContext.close();
    await wsBContext.close();
  });

  test('Hidden workspace lock + User B non-admin ne voit pas le workspace', async ({ browser }) => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    const workspaceName = `Workspace Hidden ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer Workspace Hidden (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    const workspaceId = String(created?.id || '');
    if (!workspaceId) throw new Error('workspaceId introuvable');

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b viewer (status ${addRes.status()})`);
    }

    const userAContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceId),
    });
    const pageA = await userAContext.newPage();
    await pageA.goto('/settings');
    await pageA.waitForLoadState('domcontentloaded');
    const rowA = pageA.locator('tbody tr').filter({ has: pageA.locator('.editable-input') }).first();
    await expect(rowA.locator('.editable-input').first()).toHaveValue(workspaceName, { timeout: 10_000 });
    await rowA.locator('button[title="Rendre invisible (hide)"]').click();

    await pageA.goto('/organizations');
    await pageA.waitForLoadState('domcontentloaded');
    await expect(pageA).toHaveURL(/\/settings/);

    const userBContext = await browser.newContext({
      storageState: USER_B_STATE,
    });
    const pageB = await userBContext.newPage();
    await pageB.goto('/settings');
    await pageB.waitForLoadState('domcontentloaded');
    await expect(pageB.locator('tbody tr').filter({ hasText: workspaceName })).toHaveCount(0);

    await userAContext.close();
    await userBContext.close();
    await userAApi.dispose();
  });

  test('No-workspace edge: user sans workspace', async ({ browser }) => {
    const userBContext = await browser.newContext({
      storageState: USER_B_STATE,
    });
    const pageB = await userBContext.newPage();
    await pageB.route('**/api/v1/workspaces**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });
    await pageB.goto('/organizations');
    await pageB.waitForLoadState('domcontentloaded');
    await expect(pageB).toHaveURL(/\/settings/);
    await expect(pageB.getByText(/Vous n[’']êtes membre d[’']aucun workspace|You are not a member of any workspace/i)).toBeVisible();
    await userBContext.close();
  });
});
