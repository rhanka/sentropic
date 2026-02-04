import { test, expect, request } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

const USER_A_STATE = './.auth/user-a.json';
const USER_B_STATE = './.auth/user-b.json';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

test.describe('Access control — UI admin', () => {
  test.use({ storageState: USER_A_STATE });

  test('un non-admin ne voit pas le panneau admin dans Paramètres', async ({ page }) => {
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');

    // Le panneau AdminUsersPanel est injecté seulement pour admin_app
    await expect(page.locator('h2', { hasText: 'Admin · Utilisateurs' })).toHaveCount(0);
    await expect(page.locator('text=Accès refusé (admin_app requis).')).toHaveCount(0);

    // Vérifier que la section workspace est visible pour un utilisateur non-admin
    await expect(page.locator('h2', { hasText: 'Compte & Workspace' })).toBeVisible();
    await expect(page.locator('button[aria-label="Actions workspace"]')).toBeVisible();
  });
});

test.describe.serial('Access control — roles workspace', () => {
  test.use({ storageState: USER_B_STATE });
  const workspaceName = `Workspace Access ${Date.now()}`;
  let workspaceId = '';
  let organizationId = '';
  let folderId = '';
  let useCaseId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace access (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceId = String(created?.id || '');
    if (!workspaceId) throw new Error('workspaceId introuvable');

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b (status ${addRes.status()})`);
    }

    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceId}`, {
      data: { name: `Org Access ${Date.now()}`, data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation access (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    organizationId = String(orgJson?.id || '');
    if (!organizationId) throw new Error('organizationId introuvable');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${workspaceId}`, {
      data: { name: `Folder Access ${Date.now()}`, description: 'Folder access control', organizationId },
    });
    if (!folderRes.ok()) throw new Error(`Impossible de créer dossier access (status ${folderRes.status()})`);
    const folderJson = await folderRes.json().catch(() => null);
    folderId = String(folderJson?.id || '');
    if (!folderId) throw new Error('folderId introuvable');

    const useCaseRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${workspaceId}`, {
      data: { folderId, name: `Usecase Access ${Date.now()}`, problem: 'Problème', solution: 'Solution' },
    });
    if (!useCaseRes.ok()) throw new Error(`Impossible de créer cas d'usage access (status ${useCaseRes.status()})`);
    const useCaseJson = await useCaseRes.json().catch(() => null);
    useCaseId = String(useCaseJson?.id || '');
    if (!useCaseId) throw new Error('useCaseId introuvable');

    await userAApi.dispose();
  });

  const setRole = async (role: 'viewer' | 'editor' | 'admin') => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userB = members.find((m) => m.email === 'e2e-user-b@example.com');
    if (!userB?.userId) throw new Error('userBId introuvable');
    const patchRes = await userAApi.patch(`/api/v1/workspaces/${workspaceId}/members/${userB.userId}`, {
      data: { role },
    });
    if (!patchRes.ok()) throw new Error(`Impossible de changer le rôle (status ${patchRes.status()})`);
    await userAApi.dispose();
  };

  test('User B viewer: pas de création + editors verrouillés', async ({ browser }) => {
    await setRole('viewer');
    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const page = await userBContext.newPage();

    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button, a').filter({ hasText: 'Créer' })).toHaveCount(0);

    await page.goto('/organisations/new');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/organisations(\/)?$/);

    await page.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await page.waitForLoadState('domcontentloaded');
    const editable = page.locator('.editable-input, .editable-textarea').first();
    await expect(editable).toBeDisabled({ timeout: 10_000 });
    await userBContext.close();
  });

  test('User B editor: édition OK, pas gestion membres', async ({ browser }) => {
    await setRole('editor');
    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const page = await userBContext.newPage();

    await page.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await page.waitForLoadState('domcontentloaded');
    const editable = page.locator('.editable-input, .editable-textarea').first();
    await expect(editable).toBeEnabled({ timeout: 10_000 });

    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h4', { hasText: 'Membres' })).toHaveCount(0);
    await userBContext.close();
  });

  test('User B admin: peut gérer membres + cacher/décacher + supprimer caché', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
    const adminWorkspaceName = `Workspace Admin ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: adminWorkspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace admin (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    const adminWorkspaceId = String(created?.id || '');
    if (!adminWorkspaceId) throw new Error('adminWorkspaceId introuvable');
    const addRes = await userAApi.post(`/api/v1/workspaces/${adminWorkspaceId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'admin' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b admin (status ${addRes.status()})`);
    }
    await userAApi.dispose();

    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, adminWorkspaceId),
    });
    const page = await userBContext.newPage();
    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h4', { hasText: 'Membres' })).toBeVisible();

    await expect
      .poll(async () => {
        const res = await userBApi.get('/api/v1/workspaces');
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        const items: Array<{ id: string }> = data?.items ?? [];
        return items.some((ws) => ws.id === adminWorkspaceId);
      }, { timeout: 10_000 })
      .toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.waitForResponse((res) => res.url().includes('/api/v1/workspaces') && res.request().method() === 'GET', { timeout: 10_000 }).catch(() => {});
    const row = page.locator('tbody tr').filter({ has: page.locator('.editable-input') }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.editable-input').first()).toHaveValue(adminWorkspaceName, { timeout: 10_000 });
    const hideButton = row.locator('button[title="Rendre invisible (hide)"]');
    await hideButton.click();
    await expect(row.locator('span', { hasText: 'caché' })).toBeVisible({ timeout: 10_000 });

    const unhideButton = row.locator('button[title="Rendre visible (unhide)"]');
    await unhideButton.click();
    await expect(row.locator('span', { hasText: 'caché' })).toHaveCount(0);

    await hideButton.click();
    const deleteButton = row.locator('button[title^="Supprimer définitivement"]');
    await expect(deleteButton).toBeEnabled();
    page.on('dialog', (dialog) => dialog.accept());
    await deleteButton.click();
    await expect
      .poll(async () => {
        return page.locator('input.editable-input').evaluateAll((els, name) =>
          els.some((el) => (el as HTMLInputElement).value === name), adminWorkspaceName
        );
      }, { timeout: 10_000 })
      .toBe(false);
    await userBApi.dispose();
    await userBContext.close();
  });

  test('permissions commentaires: viewer/editor/admin', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const commentRes = await userAApi.post('/api/v1/comments', {
      data: {
        context_type: 'usecase',
        context_id: useCaseId,
        section_key: 'description',
        content: 'Commentaire racine',
      },
    });
    if (!commentRes.ok()) throw new Error(`Impossible de créer commentaire racine (${commentRes.status()})`);
    await userAApi.dispose();

    const openComments = async (page: import('@playwright/test').Page) => {
      await page.goto(`/cas-usage/${encodeURIComponent(useCaseId)}`);
      await page.waitForLoadState('domcontentloaded');

      const section = page.locator('[data-comment-section="description"]');
      await section.hover();
      await section.locator('button[aria-label="Commentaires"]').click({ force: true });
      const widget = page.locator('#chat-widget-dialog');
      await expect(widget).toBeVisible({ timeout: 10_000 });
      await widget.locator('button:has-text("Commentaires")').click();

      const emptyState = widget.locator('text=Sélectionne une conversation pour commencer');
      if (await emptyState.isVisible().catch(() => false)) {
        const menuButton = widget.locator('button[aria-label="Choisir une conversation"]');
        await menuButton.click();
        const firstThread = widget.locator('button').filter({ hasText: 'Description' }).first();
        if (await firstThread.isVisible()) await firstThread.click();
      }

      return widget;
    };

    await setRole('viewer');
    const viewerContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const viewerPage = await viewerContext.newPage();
    let widget = await openComments(viewerPage);
    const composer = widget.locator('[role="textbox"][aria-label="Composer"]:visible');
    const sendButton = widget.locator('button[aria-label="Envoyer"]:visible');
    const resolveButton = widget.locator('button[aria-label="Résoudre"]:visible');
    await expect(composer).toHaveAttribute('aria-disabled', 'true');
    await expect(sendButton).toBeDisabled();
    await expect(resolveButton).toBeDisabled();
    await viewerContext.close();

    await setRole('editor');
    const editorContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const editorPage = await editorContext.newPage();
    widget = await openComments(editorPage);
    const editable = widget.locator('[role="textbox"][aria-label="Composer"]:visible [contenteditable="true"]');
    await editable.click();
    await editorPage.keyboard.type('Commentaire editor');
    const createPromise = editorPage.waitForResponse(
      (res) => res.url().includes('/api/v1/comments') && res.request().method() === 'POST'
    );
    await widget.locator('button[aria-label="Envoyer"]:visible').click();
    const createResponse = await createPromise;
    expect(createResponse.ok()).toBe(true);
    await expect(widget.locator('.userMarkdown').filter({ hasText: 'Commentaire editor' })).toBeVisible();
    await expect(widget.locator('button[aria-label="Résoudre"]')).toBeDisabled();
    await editorContext.close();

    await setRole('admin');
    const adminContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceId),
    });
    const adminPage = await adminContext.newPage();
    widget = await openComments(adminPage);
    const resolveButtonAdmin = widget.locator('button[aria-label="Résoudre"]:visible');
    await expect(resolveButtonAdmin).toBeEnabled();
    await adminContext.close();
  });
});

