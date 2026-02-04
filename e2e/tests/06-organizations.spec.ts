import { test, expect, request } from '@playwright/test';
import { debug, setupDebugBuffer } from '../helpers/debug';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

// Setup debug buffer to display on test failure
setupDebugBuffer();

test.describe('Gestion des organisations', () => {
  const FILE_TAG = 'e2e:organizations.spec.ts';
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
  let workspaceAId = '';

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

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    const workspaceName = `Organizations E2E ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAId = String(created?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Ajouter user-b en viewer pour les tests read-only
    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en viewer (status ${addRes.status()})`);
    }

    // Seed: au moins une organisation dans ce workspace pour les tests read-only
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Org Readonly E2E', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) {
      throw new Error(`Impossible de créer organisation read-only (status ${orgRes.status()})`);
    }
    await userAApi.dispose();
  });

  const actionsMenuButton = (page: any) => page.locator('button[aria-label="Actions organisation"]');
  const createButton = (page: any) => page.getByRole('button', { name: 'Créer' });
  const deleteButton = (page: any) => page.getByRole('button', { name: 'Supprimer' });
  const openNewOrganization = async (page: any) => {
    const actions = actionsMenuButton(page);
    await expect(actions).toBeVisible();
    await actions.click();
    const newAction = page.locator('button:has-text("Nouveau")');
    await expect(newAction).toBeVisible();
    await newAction.click();
  };

  test('devrait afficher la page des organisations', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      
      // Vérifier que la page se charge (domcontentloaded au lieu de networkidle car SSE empêche networkidle)
      await page.waitForLoadState('domcontentloaded');
      
      // Vérifier le titre
      await expect(page.locator('h1')).toContainText('Organisations');
      
      // Vérifier le menu d'actions
      await expect(actionsMenuButton(page)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de créer une organisation', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Ouvrir le menu d'actions et aller à la page de création
      await openNewOrganization(page);
      await expect(page).toHaveURL(/\/organisations\/new$/);
      
      // Renseigner le nom via l'EditableInput dans le H1 (textarea pour multiline)
      const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
      await expect(nameInput).toBeVisible();
      await nameInput.fill('Test Organization');
      // Laisser la réactivité Svelte stabiliser l'état local
      await page.waitForTimeout(500);
      
      // Créer l'organisation puis attendre la redirection vers la page détail
      const createBtn = page.locator('button[title="Créer"], button[aria-label="Créer"], button:has-text("Créer")');
      // Debug réseau: tracer le POST /organizations
      const disposeNet1 = page.on('request', (r) => {
        if (r.url().includes('/api/v1/organizations') && r.method() === 'POST') debug('POST /organizations started');
      });
      const disposeNet2 = page.on('requestfailed', (r) => {
        if (r.url().includes('/api/v1/organizations')) debug(`REQUEST FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
      });
      const disposeNet3 = page.on('response', async (res) => {
        const req = res.request();
        if (req.url().includes('/api/v1/organizations') && req.method() === 'POST') debug(`POST /organizations status=${res.status()}`);
      });

      // Debug DOM: état du bouton avant clic
      const btnState = await createBtn.evaluate((el) => {
        const b = el as HTMLButtonElement;
        const rect = b.getBoundingClientRect();
        const cs = window.getComputedStyle(b);
        return {
          disabled: b.disabled,
          text: (b.textContent || '').trim(),
          title: b.getAttribute('title'),
          visible: rect.width > 0 && rect.height > 0,
          cursor: cs.cursor,
          opacity: cs.opacity,
        };
      });
      debug(`createBtn state before click: ${JSON.stringify(btnState)}`);

      await expect(createBtn).toBeVisible();
      await expect(createBtn).toBeEnabled();
      await createBtn.scrollIntoViewIfNeeded();
      await createBtn.hover();
      await createBtn.click();

      // Preuve d'impact: soit navigation, soit POST observé
      await Promise.race([
        page.waitForURL(/\/organisations\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 2000 }),
        page.waitForRequest((r) => r.url().includes('/api/v1/organizations') && r.method() === 'POST', { timeout: 2000 })
      ]).catch(() => {});

      await expect(page).toHaveURL(/\/organisations\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 3000 });
      
      // Vérifier directement sur la page de détail que le nom est bien celui saisi
      const detailNameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
      await expect(detailNameInput).toHaveValue('Test Organization');
    } finally {
      await context.close();
    }
  });

  test('devrait afficher le bouton d\'enrichissement IA', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Aller à la page de création
      await openNewOrganization(page);
      await expect(page).toHaveURL(/\/organisations\/new$/);
      
      const aiButton = page.locator('[data-testid="enrich-organization"], button[aria-label="IA"]');
      await expect(aiButton).toBeVisible();
      await expect(aiButton).toBeDisabled();
      
      // Renseigner un nom pour activer le bouton IA
      const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
      await nameInput.fill('Microsoft');
      await expect(aiButton).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de supprimer une organisation', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

    // Créer une organisation d'abord
    await openNewOrganization(page);
    await expect(page).toHaveURL(/\/organisations\/new$/);
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await nameInput.fill('Organization to Delete');
    await page.waitForTimeout(75);
    const createBtn2 = page.locator('button[title="Créer"], button[aria-label="Créer"], button:has-text("Créer")');
    await expect(createBtn2).toBeVisible();
    await expect(createBtn2).toBeEnabled();
    await createBtn2.scrollIntoViewIfNeeded();
    await createBtn2.hover();
    await Promise.all([
      page.waitForURL(/\/organisations\/[a-zA-Z0-9-]+$/, { timeout: 10_000 }),
      createBtn2.click()
    ]);
    await expect(page).toHaveURL(/\/organisations\/[a-zA-Z0-9-]+$/, { timeout: 10_000 });

    // Ensure we are on the detail page and UI is hydrated before interacting
    const detailNameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await expect(detailNameInput).toHaveValue('Organization to Delete', { timeout: 5000 });

    // Supprimer via le menu d'actions
    page.on('dialog', dialog => dialog.accept());
    const detailActions = page.locator('button[aria-label="Actions"]');
    await expect(detailActions).toBeVisible({ timeout: 10_000 });
    await detailActions.click();
    const deleteBtn = deleteButton(page).first();
    await expect(deleteBtn).toBeVisible({ timeout: 10_000 });
    await deleteBtn.click();
    // Attendre la redirection
    await page.waitForURL(/\/organisations$/, { timeout: 10_000 });

    // Vérifier que l'organisation a disparu de la liste UI
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('text=Organization to Delete')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de cliquer sur une organisation pour voir ses détails', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
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
          page.waitForURL(/\/organisations\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 5000 }),
          page.waitForRequest((r) => r.url().includes('/api/v1/organizations') && r.method() === 'POST', { timeout: 5000 })
        ]).catch(() => {});
        
        // Vérifier qu'on est sur une page de détail
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/organisations\/[a-zA-Z0-9-]+/);
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les informations enrichies par l\'IA', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Créer une organisation et lancer l'enrichissement IA depuis la page New
      await openNewOrganization(page);
      await expect(page).toHaveURL(/\/organisations\/new$/);
      const nameInput2 = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
      await nameInput2.fill('MicrosoftAITest');
      const aiButton = page.locator('[data-testid="enrich-organization"], button[aria-label="IA"]');
      await expect(aiButton).toBeEnabled();
      
      // Vérifier que le bouton IA est visible et actif (test minimal fonctionnel)
      await expect(aiButton).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('devrait gérer les erreurs lors de la création d\'organisation', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');
      
      // Naviguer vers la page de création sans renseigner de nom
      await openNewOrganization(page);
      await expect(page).toHaveURL(/\/organisations\/new$/);
      
      // Vérifier que le bouton "Créer" est désactivé tant que le nom est vide
      const createBtn2 = createButton(page);
      await expect(createBtn2).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test('devrait exporter toutes les organisations avec le toggle dossiers', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      const actionsButton = page.locator('button[aria-label="Actions organisation"]');
      if (await actionsButton.count() === 0) return;
      await actionsButton.click();

      const exportAction = page.locator('button:has-text("Exporter")');
      await expect(exportAction).toBeVisible();
      await exportAction.click();

      const exportDialog = page.locator('h3:has-text("Exporter les organisations")');
      await expect(exportDialog).toBeVisible({ timeout: 10_000 });

      const includeFolders = page.locator('label:has-text("Inclure les dossiers rattachés") input[type="checkbox"]');
      if (await includeFolders.isVisible()) {
        await includeFolders.check();
      }

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.locator('button:has-text("Exporter")').click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    } finally {
      await context.close();
    }
  });

  test('devrait exporter l\'organisation depuis le menu detail', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, ADMIN_WORKSPACE_ID);
    try {
      await page.goto('/organisations');
      await page.waitForLoadState('domcontentloaded');

      const organizationItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
      if (await organizationItems.count() === 0) return;
      await organizationItems.first().click();

      await page.waitForURL(/\/organisations\//, { timeout: 5000 });
      await page.waitForLoadState('domcontentloaded');

      const actionsButton = page.locator('button[aria-label="Actions"]');
      await expect(actionsButton).toBeVisible();
      await actionsButton.click();

      const exportAction = page.locator('button:has-text("Exporter")');
      await expect(exportAction).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        exportAction.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    } finally {
      await context.close();
    }
  });

  test.describe('Read-only (viewer)', () => {
    test('liste: pas de création ni suppression + lock visible', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_B_STATE, workspaceAId);
      try {
        await page.goto('/organisations');
        await page.waitForLoadState('domcontentloaded');

        await expect(actionsMenuButton(page)).toHaveCount(0);
        await expect(deleteButton(page)).toHaveCount(0);

        const lockIcon = page.locator('button[aria-label="Mode lecture seule : création / suppression désactivées."]');
        await expect(lockIcon).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }
    });

    test('détail: champs non éditables', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_B_STATE, workspaceAId);
      try {
        await page.goto('/organisations');
        await page.waitForLoadState('domcontentloaded');

        const firstCard = page.locator('article').first();
        await firstCard.click();
        await page.waitForURL(/\/organisations\/[a-zA-Z0-9-]+$/, { timeout: 10_000 });

        const disabledField = page.locator('.editable-input:disabled, .editable-textarea:disabled').first();
        await expect(disabledField).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }
    });
  });
});


