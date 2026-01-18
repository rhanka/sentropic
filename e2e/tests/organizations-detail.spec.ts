import { test, expect, request } from '@playwright/test';

test.describe('Détail des organisations', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const USER_C_STATE = './.auth/user-victim.json';
  let workspaceAId = '';
  let organizationId = '';
  let userAId = '';
  let userBId = '';
  let userCId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const res = await userAApi.get('/api/v1/workspaces');
    if (!res.ok()) throw new Error(`Impossible de charger les workspaces (status ${res.status()})`);
    const data = await res.json().catch(() => null);
    const items: Array<{ id: string; name: string }> = data?.items ?? [];
    const workspaceA = items.find((ws) => ws.name.includes('Workspace A (E2E)'));
    if (!workspaceA) throw new Error('Workspace A (E2E) introuvable');
    workspaceAId = workspaceA.id;

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
      throw new Error(`Impossible d'ajouter user-c en editor (status ${addResC.status()})`);
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
    if (!userAId) throw new Error('User A id introuvable');
    if (!userBId) throw new Error('User B id introuvable');
    if (!userCId) throw new Error('User C id introuvable');

    const orgRes = await userAApi.get('/api/v1/organizations');
    if (!orgRes.ok()) throw new Error(`Impossible de charger les organisations (status ${orgRes.status()})`);
    const orgData = await orgRes.json().catch(() => null);
    const orgs: Array<{ id: string }> = orgData?.items ?? [];
    if (!orgs.length) throw new Error('Aucune organisation trouvée pour Workspace A');
    organizationId = orgs[0].id;

    await userAApi.dispose();
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

  test('lock/presence: User A verrouille, User B demande, User A accepte', async ({ browser }) => {
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

    // User A arrives first and acquires the lock
    await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    // Wait for User A to acquire the lock
    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.lockedBy?.userId ?? null;
      }, { timeout: 10_000 })
      .toBe(userAId);

    // Now User B arrives (should see locked view)
    await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    // Wait for page B to receive the lock update via SSE (badge should be visible)
    const badgeB = pageB.locator('div[role="group"][aria-label="Verrou du document"]');
    await expect(badgeB).toBeVisible({ timeout: 10_000 });
    // Wait a bit more for Svelte reactivity to update isLockedByOther
    await pageB.waitForTimeout(500);

    const editableFieldB = pageB.locator('.editable-input, .editable-textarea').first();
    await expect(editableFieldB).toBeDisabled({ timeout: 10_000 });

    await badgeB.hover();
    const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
    await expect(requestButton).toBeVisible({ timeout: 5_000 });
    await requestButton.click();

    // Wait for the unlock request to be processed and propagated via SSE
    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.unlockRequestedByUserId ?? null;
      }, { timeout: 10_000 })
      .toBe(userBId);

    const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
    await badgeA.hover();
    const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
    await expect(releaseButton).toBeVisible({ timeout: 5_000 });
    await releaseButton.click();

    await expect(editableFieldB).toBeEnabled({ timeout: 10_000 });

    await userAContext.close();
    await userBContext.close();
    await userAApi.dispose();
  });

  test('presence: avatars apparaissent et disparaissent au départ', async ({ browser }) => {
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

    await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageB.waitForLoadState('domcontentloaded');

    const avatarAInB = pageB.locator('[aria-label="Verrou du document"] [title="E2E User A"]');
    const avatarBInA = pageA.locator('[aria-label="Verrou du document"] [title="E2E User B"]');
    await expect(avatarAInB).toBeVisible({ timeout: 10_000 });
    await expect(avatarBInA).toBeVisible({ timeout: 10_000 });

    await pageB.close();
    await expect(avatarBInA).toHaveCount(0, { timeout: 10_000 });

    await userAContext.close();
    await userBContext.close();
  });

  test('lock breaks on leave: User A quitte → lock libéré → User B locke', async ({ browser }) => {
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
    await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    const lockRes = await userAApi.post(`/api/v1/locks?workspace_id=${workspaceAId}`, {
      data: { objectType: 'organization', objectId: organizationId },
    });
    if (!lockRes.ok() && lockRes.status() !== 409) {
      throw new Error(`Impossible d'acquérir le lock (status ${lockRes.status()})`);
    }

    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?workspace_id=${workspaceAId}&objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.lockedBy?.userId ?? null;
      }, { timeout: 10_000 })
      .toBe(userAId);

    // Navigate to another page to trigger SSE cleanup
    await pageA.goto('/organisations');
    await pageA.waitForLoadState('domcontentloaded');
    // Wait a bit for SSE cleanup to complete
    await pageA.waitForTimeout(1000);
    await userAContext.close();

    // After User A leaves, the lock should be released (null) or User B can acquire it
    // User B might auto-acquire the lock if they're on the page
    const userBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageB = await userBContext.newPage();
    const setScopeB = (id: string) => {
      return (value: string) => {
        try {
          localStorage.setItem(id, value);
        } catch {
          // ignore
        }
      };
    };
    await pageB.addInitScript(setScopeB('workspaceScopeId'), workspaceAId);
    await pageB.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    // Wait for lock to be released or acquired by User B
    await expect
      .poll(async () => {
        const res = await userBApi.get(`/api/v1/locks?workspace_id=${workspaceAId}&objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        const lock = data?.lock;
        if (!lock) return 'released';
        const lockedBy = lock?.lockedBy?.userId ?? null;
        return lockedBy === userBId ? 'acquired-by-b' : lockedBy === userAId ? 'still-locked-by-a' : 'unknown';
      }, { timeout: 15_000 })
      .toMatch(/released|acquired-by-b/);

    // Verify User B can edit (lock is released or acquired by B)
    const editableFieldB = pageB.locator('.editable-input, .editable-textarea').first();
    await expect(editableFieldB).toBeEnabled({ timeout: 10_000 });

    await userBContext.close();

    await userAApi.dispose();
    await userBApi.dispose();
  });

  test('3 utilisateurs: 2e demande refusée, transfert vers le requester', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
    const userCApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_C_STATE });

    // User A opens the page to maintain SSE connection
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
    await pageA.goto(`/organisations/${encodeURIComponent(organizationId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    // Wait for User A to acquire the lock automatically
    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?workspace_id=${workspaceAId}&objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.lockedBy?.userId ?? null;
      }, { timeout: 10_000 })
      .toBe(userAId);

    const requestB = await userBApi.post(`/api/v1/locks/request-unlock?workspace_id=${workspaceAId}`, {
      data: { objectType: 'organization', objectId: organizationId },
    });
    expect(requestB.ok()).toBeTruthy();
    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?workspace_id=${workspaceAId}&objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.unlockRequestedByUserId ?? null;
      }, { timeout: 10_000 })
      .toBe(userBId);

    const requestC = await userCApi.post(`/api/v1/locks/request-unlock?workspace_id=${workspaceAId}`, {
      data: { objectType: 'organization', objectId: organizationId },
    });
    expect([409, 403]).toContain(requestC.status());

    const acceptRes = await userAApi.post(`/api/v1/locks/accept-unlock?workspace_id=${workspaceAId}`, {
      data: { objectType: 'organization', objectId: organizationId },
    });
    expect(acceptRes.ok()).toBeTruthy();

    await expect
      .poll(async () => {
        const res = await userAApi.get(`/api/v1/locks?workspace_id=${workspaceAId}&objectType=organization&objectId=${encodeURIComponent(organizationId)}`);
        if (!res.ok()) return null;
        const data = await res.json().catch(() => null);
        return data?.lock?.lockedBy?.userId ?? null;
      }, { timeout: 10_000 })
      .toBe(userBId);

    await userAContext.close();
    await userAApi.dispose();
    await userBApi.dispose();
    await userCApi.dispose();
  });
});
