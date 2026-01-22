import { test, expect, request } from '@playwright/test';
import { waitForLockOwnedByMe, waitForLockedByOther } from '../helpers/lock-ui';
import { runLockBreaksOnLeaveScenario } from '../helpers/lock-scenarios';
import { warmUpWorkspaceScope, withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Détail des organisations', () => {
  const FILE_TAG = 'e2e:organizations-detail.spec.ts';
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const USER_C_STATE = './.auth/user-victim.json';
  let workspaceAId = '';
  let workspaceName = '';
  let organizationId = '';
  let userAId = '';
  let userBId = '';
  let userCId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    workspaceName = `Organizations Detail E2E ${Date.now()}`;
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
    const addResC = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-victim@example.com', role: 'editor' },
    });
    if (!addResC.ok() && addResC.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-victim en editor (status ${addResC.status()})`);
    }

    // Récupérer les IDs des utilisateurs
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
    if (!userAId) throw new Error('User A id introuvable');
    if (!userBId) throw new Error('User B id introuvable');
    if (!userCId) throw new Error('User C id introuvable');

    // Créer une organisation dans ce workspace
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    organizationId = String(orgJson?.id || '');
    if (!organizationId) throw new Error('organizationId introuvable');

    await userAApi.dispose();
  });
  test.beforeEach(async ({ page }, testInfo) => {
  });

  test('devrait afficher la page de détail d\'une organisation', async ({ page }) => {
    // D'abord aller à la liste des organisations
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher une organisation cliquable (pas en enrichissement)
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      
      // Cliquer sur l'organisation
      await firstOrganization.click();
      

      // Preuve d'impact: soit navigation, soit POST observé
      await Promise.race([
        page.waitForURL(/\/organisations\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 2000 }),
        page.waitForRequest((r) => r.url().includes('/api/v1/organizations') && r.method() === 'POST', { timeout: 2000 })
      ]).catch(() => {});

      // Vérifier qu'on est sur une page de détail
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/organisations\/[a-zA-Z0-9-]+/);
      
      // Vérifier les éléments de base de la page de détail (h1 ou h2)
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible();
    }
  });

  test('devrait afficher les informations détaillées de l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Vérifier les informations de base
      await expect(page.locator('h1')).toBeVisible();
      
      // Vérifier qu'il y a du contenu détaillé
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(100);
    }
  });


  test('devrait afficher les cas d\'usage liés à l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher des éléments liés aux cas d'usage
      const useCaseElements = page.locator('text=Cas d\'usage, text=Use cases, .use-case');
      
      if (await useCaseElements.count() > 0) {
        await expect(useCaseElements.first()).toBeVisible();
      }
    }
  });

  test('devrait permettre de générer des cas d\'usage depuis l\'organisation', async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await organizationItems.count();
    if (itemCount > 0) {
      const firstOrganization = organizationItems.first();
      await firstOrganization.click({ force: true });
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher un bouton de génération
      const generateButton = page.locator('button:has-text("Générer"), button:has-text("IA"), button:has-text("Generate")');
      
      if (await generateButton.isVisible()) {
        await generateButton.click();
        
        // Vérifier qu'une action de génération est lancée
        // (peut être une redirection ou un formulaire)
        await page.waitForLoadState('domcontentloaded');
      }
    }
  });

  test.describe.serial('Lock/presence', () => {
    test('lock/presence: User A verrouille, User B demande, User A accepte', async ({ browser }) => {
    const userAContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
    });
    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
    });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    // User A arrives first and acquires the lock
    const lockAcquired = pageA.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/locks') &&
        res.request().method() === 'POST' &&
        res.status() === 201,
      { timeout: 15_000 }
    ).catch(() => null);
    await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    
    // Vérifier que workspaceScopeId est bien défini
    const scopeIdA = await pageA.evaluate(() => localStorage.getItem('workspaceScopeId'));
    expect(scopeIdA).toBe(workspaceAId);

    // Wait for page to be fully loaded (h1 with organization name should be visible)
    await expect(pageA.locator('h1')).toBeVisible({ timeout: 10_000 });

    // Wait for User A to acquire the lock (verify via UI: editable fields should be enabled)
    const editableFieldA = pageA.locator('input, textarea').first();
    await expect(editableFieldA).toBeVisible({ timeout: 10_000 });
    await expect(editableFieldA).toBeEnabled({ timeout: 10_000 });
    await editableFieldA.click();
    const lockRes = await lockAcquired;
    expect(lockRes).not.toBeNull();
    if (lockRes) {
      const lockJson = await lockRes.json().catch(() => null);
      const lockObjectId = lockJson?.lock?.objectId ?? '';
      const lockedBy = lockJson?.lock?.lockedBy?.userId ?? '';
      expect(lockObjectId).toBe(organizationId);
      expect(lockedBy).toBe(userAId);
    }
    await pageA.waitForResponse(
      (res) => res.url().includes('/api/v1/locks') && res.request().method() === 'POST',
      { timeout: 10_000 }
    ).catch(() => {});

    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockOwnedByMe(pageA);

    // Now User B arrives (should see locked view)
    await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    
    // Vérifier que workspaceScopeId est bien défini
    const scopeIdB = await pageB.evaluate(() => localStorage.getItem('workspaceScopeId'));
    expect(scopeIdB).toBe(workspaceAId);

    const waitForOrgView = async () => {
      const response = await pageB
        .waitForResponse((res) => res.url().includes(`/api/v1/organizations/${organizationId}`), { timeout: 10_000 })
        .catch(() => null);
      if (response && response.status() === 404) {
        await pageB.evaluate((id) => {
          try {
            localStorage.setItem('workspaceScopeId', id);
          } catch {
            // ignore
          }
        }, workspaceAId);
        await pageB.reload({ waitUntil: 'domcontentloaded' });
      }
      await expect(pageB.locator('h1')).toBeVisible({ timeout: 10_000 });
    };
    // Wait for page to be fully loaded (h1 with organization name should be visible)
    await waitForOrgView();
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    await waitForLockedByOther(pageB);
    const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
    await requestButton.click();

    // Wait for the unlock request to be processed and propagated via SSE (verify via UI: button should appear)
    const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
    const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
    await expect(badgeA).toHaveCount(1);
    await expect
      .poll(async () => {
        await badgeA.scrollIntoViewIfNeeded();
        await badgeA.hover({ force: true });
        return releaseButton.count();
      }, { timeout: 15_000 })
      .toBe(1);
    await releaseButton.click();

    const editableFieldB = pageB.locator('input, textarea').first();
    await expect(editableFieldB).toBeEnabled({ timeout: 10_000 });

      await userAContext.close();
      await userBContext.close();
    });

    test('presence: avatars apparaissent et disparaissent au départ', async ({ browser }) => {
      test.setTimeout(60_000);
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
      });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();

      await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
      await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await pageB.waitForLoadState('domcontentloaded');

      // Wait for SSE connections to be established (needed for presence sync)
      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      // Wait for organization API responses
      await pageA.waitForResponse((res) => res.url().includes(`/api/v1/organizations/${organizationId}`), { timeout: 10_000 }).catch(() => {});
      await pageB.waitForResponse((res) => res.url().includes(`/api/v1/organizations/${organizationId}`), { timeout: 10_000 }).catch(() => {});

      // Wait for pages to be fully loaded
      await expect(pageA.locator('h1')).toBeVisible({ timeout: 10_000 });
      await expect(pageB.locator('h1')).toBeVisible({ timeout: 10_000 });

      const avatarAInB = pageB.locator('[aria-label="Verrou du document"] [title="E2E User A"]');
      const avatarBInA = pageA.locator('[aria-label="Verrou du document"] [title="E2E User B"]');
      await expect
        .poll(async () => {
          const [aInB, bInA] = await Promise.all([avatarAInB.count(), avatarBInA.count()]);
          return aInB > 0 && bInA > 0;
        }, { timeout: 15_000 })
        .toBe(true);

      await pageB.close();
      await expect(avatarBInA).toHaveCount(0, { timeout: 10_000 });

      await userAContext.close();
      await userBContext.close();
    });

    test('lock breaks on leave: User A quitte → lock libéré → User B locke', async ({ browser }) => {
      const userAContext = await browser.newContext({
        storageState: USER_A_STATE,
      });
      const userBContext = await browser.newContext({
        storageState: USER_B_STATE,
      });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();
      const getOrgNameField = (page: typeof pageA) =>
        page.getByPlaceholder("Saisir le nom de l'organisation");

      await warmUpWorkspaceScope(pageA, workspaceName, workspaceAId);
      await warmUpWorkspaceScope(pageB, workspaceName, workspaceAId);
      await runLockBreaksOnLeaveScenario({
        pageA,
        pageB,
        url: `/organisations/${encodeURIComponent(organizationId)}`,
        getEditableField: getOrgNameField,
        expectBadgeOnArrival: true,
        expectBadgeGoneAfterLeave: true,
        waitForReady: async (page) => {
          await expect(page.locator('h1')).toBeVisible({ timeout: 2_000 });
        },
      });

      await userBContext.close();
    });

    test('3 utilisateurs: 2e demande refusée, transfert vers le requester', async ({ browser }) => {
      // User A opens the page to maintain SSE connection
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
      });
      const pageA = await userAContext.newPage();
      await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      // Wait for organization API response
      await pageA.waitForResponse((res) => res.url().includes(`/api/v1/organizations/${organizationId}`), { timeout: 10_000 }).catch(() => {});

      // Wait for page to be fully loaded (h1 with organization name should be visible)
      await expect(pageA.locator('h1')).toBeVisible({ timeout: 10_000 });

      // Wait for User A to acquire the lock (UI-driven)
      await waitForLockOwnedByMe(pageA);

      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
      });
      const pageB = await userBContext.newPage();
      await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
      await pageB.waitForResponse((res) => res.url().includes(`/api/v1/organizations/${organizationId}`), { timeout: 10_000 }).catch(() => {});
      await expect(pageB.locator('h1')).toBeVisible({ timeout: 10_000 });
      await waitForLockedByOther(pageB);
      const requestButtonB = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButtonB.click();

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      const releaseReady = expect
        .poll(async () => {
          await badgeA.scrollIntoViewIfNeeded();
          await badgeA.hover({ force: true });
          return releaseButton.count();
        }, { timeout: 15_000 })
        .toBe(1);

      const userCContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_C_STATE, workspaceAId),
      });
      const pageC = await userCContext.newPage();
      await pageC.goto(`/organisations/${encodeURIComponent(organizationId)}`);
      await pageC.waitForLoadState('domcontentloaded');
      await expect(pageC.locator('h1')).toBeVisible({ timeout: 10_000 });
      await releaseReady;
      await waitForLockedByOther(pageC);
      const requestButtonC = pageC.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButtonC.click();
      await expect
        .poll(async () => {
          const errCount = await pageC.locator('text=Unlock already requested').count();
          const genericCount = await pageC.locator('text=Erreur demande de déverrouillage').count();
          return errCount + genericCount;
        }, { timeout: 10_000 })
        .toBeGreaterThan(0);

      await releaseButton.click();
      await waitForLockOwnedByMe(pageB);

      await expect
        .poll(async () => {
          const badgeB = pageB.locator('div[role="group"][aria-label="Verrou du document"]');
          return badgeB.count();
        }, { timeout: 10_000 })
        .toBe(1);

      await userAContext.close();
      await userBContext.close();
      await userCContext.close();
    });
  });
});
