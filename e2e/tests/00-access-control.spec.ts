import { test, expect, request } from '@playwright/test';

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
    await expect(page.locator('text=Créer un workspace')).toBeVisible();
  });
});

test.describe.serial('Access control — roles workspace', () => {
  test.use({ storageState: USER_B_STATE });
  const workspaceName = `Workspace Access ${Date.now()}`;
  let workspaceId = '';
  let organizationId = '';

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

  test('User B viewer: pas de création + editors verrouillés', async ({ page }) => {
    await setRole('viewer');
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, workspaceId);

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
  });

  test('User B editor: édition OK, pas gestion membres', async ({ page }) => {
    await setRole('editor');
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, workspaceId);

    await page.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await page.waitForLoadState('domcontentloaded');
    const editable = page.locator('.editable-input, .editable-textarea').first();
    await expect(editable).toBeEnabled({ timeout: 10_000 });

    await page.goto('/parametres');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h4', { hasText: 'Membres' })).toHaveCount(0);
  });

  test('User B admin: peut gérer membres + cacher/décacher + supprimer caché', async ({ page }) => {
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

    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, adminWorkspaceId);

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
  });
});

