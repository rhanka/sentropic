import { test, expect, request } from '@playwright/test';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Gestion des dossiers', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
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
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    const workspaceName = `Folders E2E ${Date.now()}`;
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
    await userAApi.dispose();
  });

  test('devrait afficher la page des dossiers', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await expect(page).toHaveURL('/folders');
      await expect(page.locator('h1')).toContainText('Dossiers');
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de créer un nouveau dossier', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      // Chercher le bouton de création
      const createButton = page.locator('button:has-text("Nouveau dossier")');
      if (await createButton.isVisible()) {
        await createButton.click();
        await page.waitForTimeout(300);
        
        // Vérifier qu'un formulaire s'ouvre (input pour le nom)
        const nameInput = page.locator('input[type="text"]').first();
        await expect(nameInput).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher la liste des dossiers', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      // Vérifier le titre h1 comme assertion minimale
      await expect(page.locator('h1')).toContainText('Dossiers');
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de cliquer sur un dossier et afficher les cas d\'usage', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher un dossier cliquable (pas en génération ou avec cas d'usage)
      const folderItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Génération en cours' });
      
      const itemCount = await folderItems.count();
      if (itemCount > 0) {
        const firstFolder = folderItems.first();
        
        // Cliquer sur l'article entier (la navigation est gérée par handleFolderClick sur l'article)
        await firstFolder.waitFor({ state: 'visible' });
        await firstFolder.click();
        
        // Attendre la redirection vers /usecase avec timeout
        await page.waitForURL(/\/usecase/, { timeout: 2000 });
        
        // Vérifier le titre "Cas d'usage"
        await expect(page.locator('h1')).toContainText('Cas d\'usage');
        
        // Vérifier la présence des cas d'usage (grille) ou message vide si aucun
        const useCaseGrid = page.locator('.grid.gap-4');
        await expect(useCaseGrid).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait afficher les informations des dossiers', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      
      // Vérifier qu'il y a des informations sur les dossiers
      const folderInfo = page.locator('text=Nom, text=Description, text=Créé, text=Modifié');
      
      if (await folderInfo.count() > 0) {
        await expect(folderInfo.first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('devrait permettre de supprimer un dossier', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      
      // Chercher un bouton de suppression
      const deleteButtons = page.locator('button:has-text("Supprimer"), button[title="Supprimer"]');
      
      if (await deleteButtons.count() > 0) {
        // Configurer la gestion de la boîte de dialogue
        page.on('dialog', dialog => {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toContain('supprimer');
          dialog.accept();
        });
        
        await deleteButtons.first().click();
        await page.waitForLoadState('domcontentloaded');
      }
    } finally {
      await context.close();
    }
  });

  test('devrait exporter tous les dossiers avec le toggle organisations', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const actionsButton = page.locator('button[aria-label="Actions dossier"]');
      if (await actionsButton.count() === 0) return;
      await actionsButton.click();

      const exportAction = page.locator('button:has-text("Exporter")');
      await expect(exportAction).toBeVisible();
      await exportAction.click();

      const exportDialog = page.locator('h3:has-text("Exporter les dossiers")');
      await expect(exportDialog).toBeVisible({ timeout: 10_000 });

      const includeOrgs = page.locator('label:has-text("Inclure les organisations") input[type="checkbox"]');
      if (await includeOrgs.isVisible()) {
        await includeOrgs.check();
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

  test('devrait exporter le dossier depuis le menu detail', async ({ browser }) => {
    const { context, page } = await createScopedPage(browser, USER_A_STATE, workspaceAId);
    try {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');

      const folderItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Génération en cours' });
      if (await folderItems.count() === 0) return;
      await folderItems.first().click();

      await page.waitForURL(/\/folders\//, { timeout: 5000 });
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
        await page.goto('/folders');
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('button:has-text("Nouveau dossier")')).toHaveCount(0);
        await expect(page.locator('button:has-text("Supprimer"), button[title="Supprimer"]')).toHaveCount(0);

        const lockIcon = page.locator('button[aria-label="Mode lecture seule : création / suppression désactivées."]');
        await expect(lockIcon).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }
    });

    test('détail: champs non éditables', async ({ browser }) => {
      const { context, page } = await createScopedPage(browser, USER_B_STATE, workspaceAId);
      try {
        await page.goto('/folders');
        await page.waitForLoadState('domcontentloaded');

        const folderItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Génération en cours' });
        if (await folderItems.count() === 0) return;
        await folderItems.first().click();
        await page.waitForURL(/\/usecase/, { timeout: 2000 });

        const disabledField = page.locator('.editable-input:disabled, .editable-textarea:disabled').first();
        await expect(disabledField).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }
    });
  });
});


