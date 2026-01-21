import { test, expect, request } from '@playwright/test';
import { warmUpWorkspaceScope } from '../helpers/workspace-scope';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
const USER_A_STATE = './.auth/user-a.json';
const USER_B_STATE = './.auth/user-b.json';
const FILE_TAG = 'e2e:tenancy-workspaces.spec.ts';
const WORKSPACE_A_ID = 'e2e-ws-a';
const WORKSPACE_B_ID = 'e2e-ws-b';


test.describe.serial('Tenancy / cloisonnement workspace', () => {

  test.describe('Workspace A', () => {
    test.use({ storageState: USER_A_STATE });

    test('ne devrait pas voir les données du workspace B', async ({ page }) => {
      await warmUpWorkspaceScope(page, 'Workspace A (E2E)', WORKSPACE_A_ID);
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });
      await expect(page.locator('body')).toContainText('Pomerleau', { timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText('Groupe BMR', { timeout: 15_000 });
    });
  });

  test.describe('Workspace B', () => {
    test.use({ storageState: USER_B_STATE });

    test('ne devrait pas voir les données du workspace A', async ({ page }) => {
      await warmUpWorkspaceScope(page, 'Workspace B (E2E)', WORKSPACE_B_ID);
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('h1')).toContainText('Organisations', { timeout: 15_000 });
      await expect(page.locator('body')).toContainText('Groupe BMR', { timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText('Pomerleau', { timeout: 15_000 });
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
      storageState: USER_B_STATE,
    });
    const pageB = await userBContext.newPage();
    await pageB.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, workspaceId);
    await pageB.goto('/parametres');
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
    await expect(pageB.locator('tbody tr').filter({ hasText: workspaceName }).locator('td').nth(2)).toHaveText('editor');

    await userAApi.patch(`/api/v1/workspaces/${workspaceId}/members/${userB.userId}`, { data: { role: 'admin' } });
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    const rowAdmin = pageB.locator('tbody tr').filter({ has: pageB.locator('.editable-input') }).first();
    await expect(rowAdmin.locator('.editable-input').first()).toHaveValue(workspaceName, { timeout: 10_000 });
    await expect(rowAdmin.locator('td').nth(2)).toHaveText('admin');

    await userBContext.close();
    await userAApi.dispose();
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
      storageState: USER_A_STATE,
    });
    const pageA = await userAContext.newPage();
    await pageA.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, workspaceId);
    await pageA.goto('/parametres');
    await pageA.waitForLoadState('domcontentloaded');
    const rowA = pageA.locator('tbody tr').filter({ has: pageA.locator('.editable-input') }).first();
    await expect(rowA.locator('.editable-input').first()).toHaveValue(workspaceName, { timeout: 10_000 });
    await rowA.locator('button[title="Rendre invisible (hide)"]').click();

    await pageA.goto('/organisations');
    await pageA.waitForLoadState('domcontentloaded');
    await expect(pageA).toHaveURL(/\/parametres/);

    const userBContext = await browser.newContext({
      storageState: USER_B_STATE,
    });
    const pageB = await userBContext.newPage();
    await pageB.goto('/parametres');
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
    await pageB.goto('/organisations');
    await pageB.waitForLoadState('domcontentloaded');
    await expect(pageB).toHaveURL(/\/parametres/);
    await expect(pageB.locator('text=Vous n’êtes membre d’aucun workspace')).toBeVisible();
    await userBContext.close();
  });
});
