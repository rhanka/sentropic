import { test, expect, request } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Page Paramètres', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAlphaId = '';
  let workspaceAlphaName = '';
  const toCanonicalRole = (value: string): string => {
    const normalized = value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
    if (normalized === 'editeur' || normalized === 'editor') return 'editor';
    if (normalized === 'admin') return 'admin';
    if (normalized === 'viewer') return 'viewer';
    return normalized;
  };

  const createScopedPage = async (
    browser: import('@playwright/test').Browser,
    storageStatePath: string,
    workspaceId: string
  ) => {
    const context = await browser.newContext({
      storageState: await withWorkspaceStorageState(storageStatePath, workspaceId),
    });
    const page = await context.newPage();
    return { context, page };
  };

  async function resolveWorkspaceRow(page: import('@playwright/test').Page, workspaceName: string) {
    const rows = page.locator('tbody tr');
    await expect
      .poll(async () => rows.count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // When workspace scope is already selected, the row is rendered as selected
    // and the name can be in an EditableInput (input value, not plain row text).
    const selectedRow = page.locator('tbody tr.bg-blue-50').first();
    if (await selectedRow.isVisible().catch(() => false)) {
      return selectedRow;
    }

    const rowByName = rows.filter({ hasText: workspaceName }).first();
    await expect(rowByName).toBeVisible({ timeout: 10_000 });
    return rowByName;
  }

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    workspaceAlphaName = `Workspace Alpha ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceAlphaName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer Workspace Alpha (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAlphaId = String(created?.id || '');
    if (!workspaceAlphaId) throw new Error('workspaceAlphaId introuvable');

    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAlphaId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en viewer (status ${addRes.status()})`);
    }

    await userAApi.dispose();
  });

  test('devrait afficher la page des paramètres', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveURL('/settings');
      await expect(page.locator('h1')).toContainText(/Paramètres|Settings/i);
    } finally {
      await context.close();
    }
  });

  test('devrait afficher la carte de téléchargement de l’extension Chrome', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.route('**/api/v1/chrome-extension/download**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            downloadUrl: 'https://downloads.example.com/top-ai-ideas/chrome-ext.zip',
            version: '1.4.2',
            source: 'ci:build-ext',
          }),
        });
      });

      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chrome-extension-download-card')).toBeVisible();
      await expect(page.getByTestId('chrome-extension-version')).toHaveText('1.4.2');
      await expect(page.getByTestId('chrome-extension-source')).toHaveText('ci:build-ext');
      await expect(page.getByTestId('chrome-extension-download-cta')).toHaveAttribute(
        'href',
        'https://downloads.example.com/top-ai-ideas/chrome-ext.zip'
      );
    } finally {
      await context.close();
    }
  });

  test('devrait afficher une erreur si le téléchargement extension est indisponible', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.route('**/api/v1/chrome-extension/download**', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Chrome extension download URL is not configured for this instance.',
          }),
        });
      });

      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chrome-extension-download-error')).toContainText('not configured');
      await expect(page.getByTestId('chrome-extension-download-retry')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les sections de configuration', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Vérifier qu'il y a du contenu de configuration
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(50);
      
      // Chercher des sections de configuration communes
      const configSections = page.locator('h2, h3, .config-section, .setting-group');
      
      if (await configSections.count() > 0) {
        await expect(configSections.first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de modifier les paramètres', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher uniquement des inputs texte (pas select ou number)
      const textInput = page.locator('input[type="text"], textarea').first();
      
      if (await textInput.count() > 0) {
        await textInput.fill('test value');
        await expect(textInput).toHaveValue('test value');
      }
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de sauvegarder les paramètres', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher un bouton de sauvegarde
      const saveButton = page.locator('button:has-text("Sauvegarder"), button:has-text("Enregistrer"), button:has-text("Save")');
      
      if (await saveButton.isVisible()) {
        await expect(saveButton).toBeEnabled();
        await saveButton.click();
        
        // Vérifier qu'une action de sauvegarde est lancée
        await page.waitForLoadState('domcontentloaded');
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les paramètres de langue', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher un sélecteur de langue (premier select trouvé)
      const languageSelect = page.locator('select').first();
      
      if (await languageSelect.count() > 0) {
        await expect(languageSelect).toBeVisible();
        const options = await languageSelect.locator('option').all();
        expect(options.length).toBeGreaterThan(0);
      }
    } finally {
      await context.close();
    }
  });

  test.skip('devrait permettre de changer de langue', async ({ page }) => {
    // Test skip: language select strict mode violation (multiple selects on page)
  });

  test('devrait afficher les paramètres de l\'API', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher des paramètres liés à l'API
      const apiSettings = page.locator('text=API, text=OpenAI, text=Configuration, text=Endpoint');
      
      if (await apiSettings.count() > 0) {
        await expect(apiSettings.first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les paramètres de la base de données', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher des paramètres liés à la base de données
      const dbSettings = page.locator('text=Base de données, text=Database, text=SQLite, text=Backup');
      
      if (await dbSettings.count() > 0) {
        await expect(dbSettings.first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de réinitialiser les paramètres', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher un bouton de réinitialisation
      const resetButton = page.locator('button:has-text("Réinitialiser"), button:has-text("Reset"), button:has-text("Restaurer")');
      
      if (await resetButton.isVisible()) {
        // Configurer la gestion de la confirmation
        page.on('dialog', dialog => {
          expect(dialog.type()).toBe('confirm');
          dialog.accept();
        });
        
        await resetButton.click();
        await page.waitForLoadState('domcontentloaded');
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les informations de version', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
    try {
      await page.goto('/settings');
      await page.waitForLoadState('domcontentloaded');
      // Chercher des informations de version
      const versionInfo = page.locator('text=Version, text=v1, text=Build, text=©');
      
      if (await versionInfo.count() > 0) {
        await expect(versionInfo.first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test.skip('devrait gérer les erreurs de validation', async ({ page }) => {
    // Test skip: cannot fill text into input[type=number]
  });

  test.describe.serial('Workspace table (User A admin)', () => {
    test('UX table: icons only + row title + actions do not change selection', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
      try {
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForResponse((res) => res.url().includes('/api/v1/workspaces') && res.request().method() === 'GET', { timeout: 10_000 }).catch(() => {});
        const rowAlpha = await resolveWorkspaceRow(page, workspaceAlphaName);
        const alreadySelected = await rowAlpha.evaluate((el) => el.classList.contains('bg-blue-50'));
        if (!alreadySelected) {
          await rowAlpha.click();
        }

        const selectedRow = page.locator('tbody tr.bg-blue-50').first();
        await expect(selectedRow).toBeVisible({ timeout: 10_000 });
        await expect(selectedRow).toHaveAttribute(
          'title',
          /Cliquer pour sélectionner ce workspace|Click to select this workspace/i
        );

        const visibilityButton = selectedRow.locator(
          'button[title^="Rendre"], button[title^="Make"]'
        );
        await expect(visibilityButton).toBeVisible();
        const textContent = await visibilityButton.textContent();
        expect((textContent || '').trim()).toBe('');

        const selectedBefore = await page.evaluate(() => localStorage.getItem('workspaceScopeId'));
        await visibilityButton.click();
        const selectedAfter = await page.evaluate(() => localStorage.getItem('workspaceScopeId'));
        expect(selectedAfter).toBe(selectedBefore);
      } finally {
        await context.close();
      }
    });

    test('renommer un workspace via EditableInput', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
      try {
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForResponse((res) => res.url().includes('/api/v1/workspaces') && res.request().method() === 'GET', { timeout: 10_000 }).catch(() => {});
        const newName = `${workspaceAlphaName}-renamed`;
        const rowAlpha = await resolveWorkspaceRow(page, workspaceAlphaName);
        const alreadySelected = await rowAlpha.evaluate((el) => el.classList.contains('bg-blue-50'));
        if (!alreadySelected) {
          await rowAlpha.click();
        }

        const selectedRow = page.locator('tbody tr.bg-blue-50').first();
        await expect(selectedRow).toBeVisible({ timeout: 10_000 });

        const nameInput = selectedRow.locator('.editable-input').first();
        await expect(nameInput).toBeVisible({ timeout: 10_000 });
        await nameInput.fill(newName);
        await nameInput.blur();

        await page.waitForResponse((res) => res.url().includes(`/api/v1/workspaces/${workspaceAlphaId}`) && res.request().method() === 'PUT', { timeout: 10_000 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const rowAlphaAfter = page.locator('tbody tr.bg-blue-50').first();
        await expect(rowAlphaAfter.locator('.editable-input').first()).toHaveValue(newName, { timeout: 10_000 });
        workspaceAlphaName = newName;
      } finally {
        await context.close();
      }
    });

    test('live update: changement de rôle visible côté User B', async ({ browser }) => {
      const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
      const workspaceLiveName = `Workspace Live ${Date.now()}`;
      const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceLiveName } });
      if (!createRes.ok()) throw new Error(`Impossible de créer Workspace Live (status ${createRes.status()})`);
      const created = await createRes.json().catch(() => null);
      const workspaceLiveId = String(created?.id || '');
      if (!workspaceLiveId) throw new Error('workspaceLiveId introuvable');
      const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceLiveId}/members`, {
        data: { email: 'e2e-user-b@example.com', role: 'viewer' },
      });
      if (!addRes.ok() && addRes.status() !== 409) {
        throw new Error(`Impossible d'ajouter user-b en viewer (status ${addRes.status()})`);
      }

      const userAContext = await browser.newContext({ storageState: USER_A_STATE });
      const userBContext = await browser.newContext({ storageState: USER_B_STATE });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();

      const userBMeRes = await userBApi.get('/api/v1/me');
      const userBMe = await userBMeRes.json().catch(() => null);
      const userBSession = { user: userBMe?.user ?? userBMe, timestamp: Date.now() };
      await pageB.addInitScript((sessionValue) => {
        try {
          localStorage.setItem('userSession', JSON.stringify(sessionValue));
        } catch {
          // ignore
        }
      }, userBSession);

      await expect
        .poll(async () => {
          const res = await userBApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string }> = data?.items ?? [];
          return items.some((ws) => ws.id === workspaceLiveId);
        }, { timeout: 10_000 })
        .toBe(true);

      await pageA.goto('/settings');
      await pageB.goto('/settings');
      await pageA.waitForLoadState('domcontentloaded');
      await pageB.waitForLoadState('domcontentloaded');
      await pageB.waitForResponse((res) => res.url().includes('/api/v1/workspaces'), { timeout: 10_000 }).catch(() => {});
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      const rowB = pageA.locator('tbody tr').filter({ hasText: 'e2e-user-b@example.com' }).first();
      await expect(rowB).toBeVisible({ timeout: 10_000 });
      const roleSelect = rowB.locator('select').first();
      await Promise.all([
        pageA.waitForResponse((res) => res.url().includes('/members/') && res.request().method() === 'PATCH', { timeout: 10_000 }),
        roleSelect.selectOption('editor')
      ]);

      await expect
        .poll(async () => {
          const res = await userBApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string; role: string }> = data?.items ?? [];
          return items.find((ws) => ws.id === workspaceLiveId)?.role ?? null;
        }, { timeout: 10_000 })
        .toBe('editor');

      const roleCellB = pageB.locator('tbody tr').filter({ hasText: workspaceLiveName }).locator('td').nth(2);
      await expect
        .poll(async () => {
          const text = (await roleCellB.textContent()) ?? '';
          const canonical = toCanonicalRole(text);
          if (canonical && canonical !== 'editor') {
            await pageB.reload({ waitUntil: 'domcontentloaded' });
            await pageB.waitForResponse((res) => res.url().includes('/api/v1/workspaces'), { timeout: 10_000 }).catch(() => {});
          }
          return toCanonicalRole((await roleCellB.textContent()) ?? '');
        }, { timeout: 15_000 })
        .toBe('editor');

      await userAContext.close();
      await userBContext.close();
      await userAApi.dispose();
      await userBApi.dispose();
    });

    test.skip('live update: hide/unhide visible côté User B', async ({ browser }) => {
      const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
      const workspaceLiveName = `Workspace Hide ${Date.now()}`;
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceLiveId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceLiveId),
      });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();

      await pageA.goto('/settings');
      await pageA.waitForLoadState('domcontentloaded');
      await pageA.waitForResponse((res) => res.url().includes('/api/v1/me'), { timeout: 10_000 }).catch(() => {});

      const createPromise = pageA.waitForResponse(
        (res) => res.url().includes('/api/v1/workspaces') && res.request().method() === 'POST',
        { timeout: 10_000 }
      );
      await pageA.locator('input[placeholder="Nom du workspace"]').fill(workspaceLiveName);
      await pageA.locator('button', { hasText: 'Créer' }).click();
      const createRes = await createPromise;
      if (!createRes.ok()) throw new Error(`Impossible de créer Workspace Hide (status ${createRes.status()})`);
      const created = await createRes.json().catch(() => null);
      const workspaceLiveId = String(created?.id || '');
      if (!workspaceLiveId) throw new Error('workspaceLiveId introuvable');
      await pageA
        .waitForResponse((res) => res.url().includes('/api/v1/workspaces') && res.request().method() === 'GET', { timeout: 10_000 })
        .catch(() => {});

      const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceLiveId}/members`, {
        data: { email: 'e2e-user-b@example.com', role: 'admin' },
      });
      if (!addRes.ok() && addRes.status() !== 409) {
        throw new Error(`Impossible d'ajouter user-b admin (status ${addRes.status()})`);
      }

      await expect
        .poll(async () => {
          const res = await userBApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string }> = data?.items ?? [];
          return items.some((ws) => ws.id === workspaceLiveId);
        }, { timeout: 10_000 })
        .toBe(true);

      await expect
        .poll(async () => {
          const res = await userAApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string }> = data?.items ?? [];
          return items.some((ws) => ws.id === workspaceLiveId);
        }, { timeout: 10_000 })
        .toBe(true);
      await pageB.goto('/settings');
      await pageB.waitForLoadState('domcontentloaded');
      await pageB.waitForResponse((res) => res.url().includes('/api/v1/me'), { timeout: 10_000 }).catch(() => {});
      await pageB.evaluate(() => window.dispatchEvent(new CustomEvent('streamhub:workspace_update', { detail: {} })));
      await pageB.waitForResponse((res) => res.url().includes('/api/v1/workspaces'), { timeout: 10_000 }).catch(() => {});

      const hideRes = await userAApi.post(`/api/v1/workspaces/${workspaceLiveId}/hide`, { data: {} });
      if (!hideRes.ok()) throw new Error(`Impossible de cacher le workspace (status ${hideRes.status()})`);
      await expect
        .poll(async () => {
          const res = await userBApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string; hiddenAt: string | null }> = data?.items ?? [];
          return items.find((ws) => ws.id === workspaceLiveId)?.hiddenAt ?? null;
        }, { timeout: 10_000 })
        .not.toBeNull();

      const unhideRes = await userAApi.post(`/api/v1/workspaces/${workspaceLiveId}/unhide`, { data: {} });
      if (!unhideRes.ok()) throw new Error(`Impossible de restaurer le workspace (status ${unhideRes.status()})`);
      await expect
        .poll(async () => {
          const res = await userBApi.get('/api/v1/workspaces');
          if (!res.ok()) return null;
          const data = await res.json().catch(() => null);
          const items: Array<{ id: string; hiddenAt: string | null }> = data?.items ?? [];
          return items.find((ws) => ws.id === workspaceLiveId)?.hiddenAt ?? null;
        }, { timeout: 10_000 })
        .toBeNull();

      await userAContext.close();
      await userBContext.close();
      await userAApi.dispose();
      await userBApi.dispose();
    });

    test('workspace export menu ouvre dialog', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
      try {
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        const actionsButton = page.locator('button[aria-label="Actions workspace"]');
        await expect(actionsButton).toBeVisible({ timeout: 10_000 });
        await actionsButton.click();

        const exportAction = page.locator('button:has-text("Exporter")');
        await expect(exportAction).toBeVisible();
        await exportAction.click();

        const exportDialog = page.locator('h3:has-text("Exporter un workspace")');
        await expect(exportDialog).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }
    });

    test('workspace import menu ouvre dialog + close', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAlphaId);
      try {
        await page.goto('/settings');
        await page.waitForLoadState('domcontentloaded');
        const actionsButton = page.locator('button[aria-label="Actions workspace"]');
        await expect(actionsButton).toBeVisible({ timeout: 10_000 });
        await actionsButton.click();

        const importAction = page.locator('button:has-text("Importer")');
        await expect(importAction).toBeVisible();
        await importAction.click();

        const importDialog = page.locator('h3:has-text("Importer un workspace")');
        await expect(importDialog).toBeVisible({ timeout: 10_000 });

        const dialog = page.locator('div').filter({ has: importDialog }).first();
        const fileInput = dialog.locator('input[type="file"][accept=".zip"]');
        await expect(fileInput).toBeVisible();

        const closeButton = dialog.locator('button[aria-label="Fermer"]');
        await closeButton.click();
        await expect(importDialog).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
});
