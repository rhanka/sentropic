import { test, expect, request } from '@playwright/test';
import { waitForLockOwnedByMe, waitForLockedByOther } from '../helpers/lock-ui';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Dossiers — reload & brouillons', () => {
  const FILE_TAG = 'e2e:dossiers-reload-draft.spec.ts';
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const USER_C_STATE = './.auth/user-victim.json';
  let workspaceAId = '';
  let organizationId = '';
  let folderId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    const workspaceName = `Dossiers Reload E2E ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAId = String(created?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Ajouter les membres nécessaires
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

    // Récupérer les IDs des utilisateurs
    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceAId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userA = members.find((member) => member.email === 'e2e-user-a@example.com');
    const userB = members.find((member) => member.email === 'e2e-user-b@example.com');
    const userC = members.find((member) => member.email === 'e2e-user-victim@example.com');
    if (!userA?.userId || !userB?.userId || !userC?.userId) {
      throw new Error('User A/B/C id introuvable');
    }

    // Créer une organisation et un dossier dans ce workspace
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    organizationId = String(orgJson?.id || '');
    if (!organizationId) throw new Error('organizationId introuvable');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${workspaceAId}`, {
      data: { name: 'Dossier Test', description: 'Dossier pour tests dossiers-reload-draft', organizationId },
    });
    if (!folderRes.ok()) throw new Error(`Impossible de créer dossier (status ${folderRes.status()})`);
    const folderJson = await folderRes.json().catch(() => null);
    const items: Array<{ id: string }> = folderJson ? [{ id: String(folderJson.id || '') }] : [];
    if (!items.length) throw new Error('Aucun dossier trouvé pour Workspace A');
    folderId = items[0].id;

    await userAApi.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
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
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
      });
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

      // workspaceScopeId hydrated via storageState

      await pageA.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      const editableFieldA = pageA.locator('input:not([type="file"]):not(.hidden), textarea').first();
      if ((await editableFieldA.count()) > 0) {
        await editableFieldA.click();
        await pageA.waitForResponse(
          (res) => res.url().includes('/api/v1/locks') && res.request().method() === 'POST',
          { timeout: 10_000 }
        ).catch(() => {});
      }
      await waitForLockOwnedByMe(pageA);

      await pageB.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      await waitForLockedByOther(pageB);
      const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButton.click();

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      await expect
        .poll(async () => {
          await badgeA.hover({ force: true });
          return releaseButton.count();
        }, { timeout: 10_000 })
        .toBe(1);
      await releaseButton.click();

      await waitForLockOwnedByMe(pageB);

      await userAContext.close();
      await userBContext.close();
    });

    test('User A leaves → lock released → User B can lock', async ({ browser }) => {
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
      });
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

      // workspaceScopeId hydrated via storageState
      await pageA.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      await waitForLockOwnedByMe(pageA);

      await userAContext.close();

      // workspaceScopeId hydrated via storageState
      await pageB.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      const editableFieldB = pageB.locator('input:not([type="file"]):not(.hidden), textarea').first();
      if ((await editableFieldB.count()) > 0) {
        await editableFieldB.click();
        await pageB.waitForResponse(
          (res) => res.url().includes('/api/v1/locks') && res.request().method() === 'POST',
          { timeout: 10_000 }
        ).catch(() => {});
      }
      await waitForLockOwnedByMe(pageB);
    });

    test('3 utilisateurs: 2e demande refusée, transfert vers le requester', async ({ browser }) => {
      const userAApi = await request.newContext({
        baseURL: API_BASE_URL,
        storageState: USER_A_STATE,
      });
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
      });
      const userCContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_C_STATE, workspaceAId),
      });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();
      const pageC = await userCContext.newPage();

      const folderName = `Dossier Lock 3 users ${Date.now()}`;
      const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${workspaceAId}`, {
        data: { name: folderName, description: 'Dossier lock 3 users', organizationId },
      });
      if (!folderRes.ok()) throw new Error(`Impossible de créer le dossier (status ${folderRes.status()})`);
      const folderJson = await folderRes.json().catch(() => null);
      const testFolderId = String(folderJson?.id || '');
      if (!testFolderId) throw new Error('testFolderId introuvable');

      const setScope = (id: string) => {
        return (value: string) => {
          try {
            localStorage.setItem(id, value);
          } catch {
            // ignore
          }
        };
      };

      // workspaceScopeId hydrated via storageState

      await pageA.goto(`/dossiers/${encodeURIComponent(testFolderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });

      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      await waitForLockOwnedByMe(pageA);

      await pageB.goto(`/dossiers/${encodeURIComponent(testFolderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      await waitForLockedByOther(pageB);
      const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButton.click();

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      await expect
        .poll(async () => {
          await badgeA.hover({ force: true });
          return releaseButton.count();
        }, { timeout: 10_000 })
        .toBe(1);
      const releaseLabelBefore = (await releaseButton.getAttribute('aria-label')) || '';

      await pageC.goto(`/dossiers/${encodeURIComponent(testFolderId)}`);
      await pageC.waitForLoadState('domcontentloaded');
      await expect(pageC.locator('text=Contexte').first()).toBeVisible({ timeout: 10_000 });
      await waitForLockedByOther(pageC);
      const requestButtonC = pageC.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButtonC.click();

      await expect
        .poll(async () => {
          await badgeA.hover({ force: true });
          return (await releaseButton.getAttribute('aria-label')) || '';
        }, { timeout: 5_000 })
        .toBe(releaseLabelBefore);

      await releaseButton.click();

      await waitForLockOwnedByMe(pageB);

      await userAContext.close();
      await userBContext.close();
      await userCContext.close();
      await userAApi.dispose();
    });
  });
});


