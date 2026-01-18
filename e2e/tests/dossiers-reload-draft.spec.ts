import { test, expect, request } from '@playwright/test';

test.describe('Dossiers — reload & brouillons', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const USER_C_STATE = './.auth/user-victim.json';
  let workspaceAId = '';
  let folderId = '';
  let userAId = '';
  let userBId = '';
  let userCId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const workspacesRes = await userAApi.get('/api/v1/workspaces');
    expect(workspacesRes.ok()).toBeTruthy();
    const workspacesJson = await workspacesRes.json().catch(() => null);
    const workspaces: Array<{ id: string; name: string }> = workspacesJson?.items ?? [];
    const workspaceA = workspaces.find((ws) => ws.name.includes('Workspace A (E2E)'));
    if (!workspaceA) throw new Error('Workspace A (E2E) introuvable');
    workspaceAId = workspaceA.id;

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'editor' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en editor (status ${addRes.status()})`);
    }

    const addCRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-victim@example.com', role: 'editor' },
    });
    if (!addCRes.ok() && addCRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-victim en editor (status ${addCRes.status()})`);
    }

    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceAId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userA = members.find((member) => member.email === 'e2e-user-a@example.com');
    const userB = members.find((member) => member.email === 'e2e-user-b@example.com');
    const userC = members.find((member) => member.email === 'e2e-user-victim@example.com');
    userAId = userA?.userId ?? '';
    userBId = userB?.userId ?? '';
    userCId = userC?.userId ?? '';
    if (!userAId || !userBId || !userCId) throw new Error('User A/B/C id introuvable');

    const foldersRes = await userAApi.get('/api/v1/folders');
    expect(foldersRes.ok()).toBeTruthy();
    const foldersJson = await foldersRes.json().catch(() => null);
    const items: Array<{ id: string }> = foldersJson?.items ?? [];
    if (!items.length) throw new Error('Aucun dossier trouvé pour Workspace A');
    folderId = items[0].id;

    await userAApi.dispose();
  });

  test.beforeEach(async ({ page }) => {
    // Stabiliser: forcer le scope admin sur la workspace admin (sinon mode "lecture seule" possible).
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, ADMIN_WORKSPACE_ID);
  });

  test('CTRL+R: reload sur /dossiers/[id] ne casse pas (fallback SPA)', async ({ page }) => {
    // Récupérer un dossier existant via API (seed E2E)
    const foldersRes = await page.request.get(`${API_BASE_URL}/api/v1/folders`);
    expect(foldersRes.ok()).toBeTruthy();
    const foldersJson = await foldersRes.json().catch(() => null);
    const items: any[] = (foldersJson as any)?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const folderId = String(items[0]?.id ?? '');
    expect(folderId).toBeTruthy();

    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');

    // Signal minimal que la page est hydratée
    await expect(page.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

    // Simuler un refresh (CTRL+R). On utilise reload() (équivalent E2E).
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Toujours OK après reload
    await expect(page.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Draft: cliquer la carte “Brouillon” renvoie vers /dossier/new?draft=...', async ({ page }) => {
    // Créer un draft dédié (évite les flakys + dépendance au seed)
    const draftName = `E2E Draft ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: draftName, description: 'Draft created by dossiers-reload-draft.spec.ts' }
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json().catch(() => null);
    const draftId = String((draftJson as any)?.id ?? '');
    expect(draftId).toBeTruthy();

    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');

    const draftCard = page.locator('.grid.gap-4 > article').filter({ hasText: draftName }).first();
    await expect(draftCard).toBeVisible({ timeout: 10_000 });

    await draftCard.click();
    await page.waitForURL(new RegExp(`/dossier/new\\?draft=${draftId}$`), { timeout: 10_000 });

    // Vérifier que le nom est bien celui du draft (EditableInput dans H1)
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toHaveValue(draftName);
  });

  test.describe.serial('Folder lock/presence', () => {
    test('User A locks → User B sees → unlock accept', async ({ browser }) => {
      const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      const userAContext = await browser.newContext({ storageState: USER_A_STATE });
      const userBContext = await browser.newContext({ storageState: USER_B_STATE });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();

      const setScope = (id: string) => {
        return (value: string) => {
          try {
            localStorage.setItem(id, value);
          } catch {
            // ignore
          }
        };
      };

      await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
      await pageB.addInitScript(setScope('workspaceScopeId'), workspaceAId);

      await pageA.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.lockedBy?.userId ?? null;
        }, { timeout: 10_000 })
        .toBe(userAId);

      await pageB.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      const badgeB = pageB.locator('div[role="group"][aria-label="Verrou du document"]');
      await expect(badgeB).toBeVisible({ timeout: 10_000 });
      await badgeB.hover();
      const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await expect(requestButton).toBeVisible({ timeout: 5_000 });
      await requestButton.click();

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      await badgeA.hover();
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      await expect(releaseButton).toBeVisible({ timeout: 5_000 });
      await releaseButton.click();

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.lockedBy?.userId ?? null;
        }, { timeout: 10_000 })
        .toBe(userBId);

      await userAContext.close();
      await userBContext.close();
      await userAApi.dispose();
    });

    test('User A leaves → lock released → User B can lock', async ({ browser }) => {
      const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
      const userAContext = await browser.newContext({ storageState: USER_A_STATE });
      const pageA = await userAContext.newPage();

      const setScope = (id: string) => {
        return (value: string) => {
          try {
            localStorage.setItem(id, value);
          } catch {
            // ignore
          }
        };
      };

      await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
      await pageA.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.lockedBy?.userId ?? null;
        }, { timeout: 10_000 })
        .toBe(userAId);

      await userAContext.close();

      await expect
        .poll(async () => {
          const res = await userBApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock ?? null;
        }, { timeout: 10_000 })
        .toBeNull();

      const acquireRes = await userBApi.post('/api/v1/locks', {
        data: { objectType: 'folder', objectId: folderId },
      });
      if (!acquireRes.ok() && acquireRes.status() !== 409) {
        throw new Error(`Impossible d'acquérir le lock folder (status ${acquireRes.status()})`);
      }
      const acquireJson = await acquireRes.json().catch(() => null);
      const lockedBy = acquireJson?.lock?.lockedBy?.userId ?? null;
      expect(lockedBy).toBe(userBId);

      await userAApi.dispose();
      await userBApi.dispose();
    });

    test('3 utilisateurs: 2e demande refusée, transfert vers le requester', async ({ browser }) => {
      const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
      const userCApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_C_STATE });
      const userAContext = await browser.newContext({ storageState: USER_A_STATE });
      const userBContext = await browser.newContext({ storageState: USER_B_STATE });
      const userCContext = await browser.newContext({ storageState: USER_C_STATE });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();
      const pageC = await userCContext.newPage();

      const setScope = (id: string) => {
        return (value: string) => {
          try {
            localStorage.setItem(id, value);
          } catch {
            // ignore
          }
        };
      };

      await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
      await pageB.addInitScript(setScope('workspaceScopeId'), workspaceAId);
      await pageC.addInitScript(setScope('workspaceScopeId'), workspaceAId);

      await pageA.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.lockedBy?.userId ?? null;
        }, { timeout: 10_000 })
        .toBe(userAId);

      await pageB.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      const badgeB = pageB.locator('div[role="group"][aria-label="Verrou du document"]');
      await expect(badgeB).toBeVisible({ timeout: 10_000 });
      await badgeB.hover();
      const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await expect(requestButton).toBeVisible({ timeout: 5_000 });
      await requestButton.click();

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.unlockRequestedByUserId ?? null;
        }, { timeout: 10_000 })
        .toBe(userBId);

      await pageC.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageC.waitForLoadState('domcontentloaded');
      await expect(pageC.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      const badgeC = pageC.locator('div[role="group"][aria-label="Verrou du document"]');
      await expect(badgeC).toBeVisible({ timeout: 10_000 });

      const secondReq = await userCApi.post(
        `/api/v1/locks/request-unlock?workspace_id=${encodeURIComponent(workspaceAId)}`,
        { data: { objectType: 'folder', objectId: folderId } }
      );
      expect(secondReq.status()).toBe(409);

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      await badgeA.hover();
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      await expect(releaseButton).toBeVisible({ timeout: 5_000 });
      await releaseButton.click();

      await expect
        .poll(async () => {
          const res = await userAApi.get(`/api/v1/locks?objectType=folder&objectId=${encodeURIComponent(folderId)}`);
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          return data?.lock?.lockedBy?.userId ?? null;
        }, { timeout: 10_000 })
        .toBe(userBId);

      await userAContext.close();
      await userBContext.close();
      await userCContext.close();
      await userAApi.dispose();
      await userBApi.dispose();
      await userCApi.dispose();
    });
  });
});


