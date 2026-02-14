import { test, expect, type Page } from '@playwright/test';

test.describe('Internationalization reliability', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: './.auth/user-a.json' });

  const WORKSPACE_ID = 'e2e-ws-a';
  const FOLDER_ID = 'e2e-folder-a';
  const FOLDER_NAME = 'Pomerleau — Cas E2E (tenancy A)';

  const setDashboardScope = async (page: Page) => {
    await page.addInitScript(
      ({ workspaceId, folderId }) => {
        window.localStorage.setItem('workspaceScopeId', workspaceId);
        window.localStorage.setItem('currentFolderId', folderId);
      },
      { workspaceId: WORKSPACE_ID, folderId: FOLDER_ID }
    );
  };

  const setLanguage = async (page: Page, lang: 'fr' | 'en') => {
    const languageSelect = page.locator('header select').first();
    await expect(languageSelect).toBeVisible({ timeout: 15_000 });
    await languageSelect.selectOption(lang);
    await expect(languageSelect).toHaveValue(lang);
  };

  const waitForWorkspaceHydration = async (page: Page) => {
    await page
      .waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes('/api/v1/workspaces'),
        { timeout: 15_000 }
      )
      .catch(() => null);
  };

  const openFolderNewFromFolders = async (page: Page) => {
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');
    await waitForWorkspaceHydration(page);

    const actionsButton = page.getByRole('button', { name: /Actions/i }).first();
    await expect(actionsButton).toBeVisible({ timeout: 15_000 });
    await actionsButton.click();

    const newButton = page.getByRole('button', { name: /New|Nouveau/i }).first();
    await expect(newButton).toBeVisible({ timeout: 10_000 });
    await newButton.click();
    await page.waitForURL(/\/folder\/new/, { timeout: 10_000 });
  };

  const ensureFolderContextSelected = async (page: Page) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await waitForWorkspaceHydration(page);

      const folderCard = page
        .locator('article[role="button"]')
        .filter({ has: page.getByRole('heading', { name: FOLDER_NAME, level: 2 }) })
        .first();
      await expect(folderCard).toBeVisible({ timeout: 10_000 });
      await folderCard.click({ force: true });
      await page.waitForURL(new RegExp(`/folders/${FOLDER_ID}`), { timeout: 10_000 });

      const evaluationLink = page.getByRole('link', { name: /Evaluation|Évaluation/i });
      if ((await evaluationLink.getAttribute('aria-disabled')) !== 'true') {
        // Scope hydration can clear currentFolderId shortly after navigation; require stability.
        await page.waitForTimeout(600);
      }
      if ((await evaluationLink.getAttribute('aria-disabled')) !== 'true') {
        return;
      }

      await page.waitForTimeout(400);
    }

    throw new Error('Unable to select an active folder context for matrix navigation');
  };

  const ensureMatrixWarningBanner = async (page: Page, lang: 'fr' | 'en') => {
    await ensureFolderContextSelected(page);
    await page.goto('/matrix');
    await page.waitForLoadState('domcontentloaded');
    await waitForWorkspaceHydration(page);
    await setLanguage(page, lang);

    const warningText =
      lang === 'fr'
        ? "Attention : Modifier les poids recalculera automatiquement tous les scores de vos cas d'usage existants."
        : 'Warning: changing weights will automatically recalculate all scores for your existing use cases.';
    const emptyText = lang === 'fr' ? 'Aucune matrice configurée pour ce dossier' : 'No matrix configured for this folder';
    const createLabel = lang === 'fr' ? 'Créer une nouvelle matrice' : 'Create a new matrix';
    const createDialogBody = lang === 'fr' ? 'Choisissez le type de matrice à créer :' : 'Choose the type of matrix to create:';
    const baseLabel = lang === 'fr' ? 'Évaluation de base' : 'Base evaluation';
    const copyLabel = lang === 'fr' ? 'Copier une matrice existante' : 'Copy an existing matrix';
    const blankLabel = lang === 'fr' ? 'Évaluation vierge' : 'Blank evaluation';
    const closeButtonLabel = lang === 'fr' ? 'Annuler' : 'Cancel';

    const warningLocator = page.getByText(warningText);
    if (await warningLocator.isVisible().catch(() => false)) {
      return;
    }

    // Fallback path when no active matrix is loaded: keep deterministic i18n checks in the matrix area.
    await expect(page.getByText(emptyText)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: createLabel }).click();
    const createDialog = page.locator('div.fixed.inset-0.bg-black.bg-opacity-50').last();
    await expect(createDialog).toBeVisible({ timeout: 5_000 });
    await expect(createDialog.getByText(createDialogBody)).toBeVisible({ timeout: 5_000 });
    await expect(createDialog.getByText(baseLabel)).toBeVisible({ timeout: 5_000 });
    await expect(createDialog.getByText(copyLabel)).toBeVisible({ timeout: 5_000 });
    await expect(createDialog.getByText(blankLabel)).toBeVisible({ timeout: 5_000 });
    await createDialog.getByRole('button', { name: closeButtonLabel, exact: true }).click();
  };

  const expectFolderNamePlaceholder = async (page: Page, text: string) => {
    const byPlaceholder = page.getByPlaceholder(text);
    if (await byPlaceholder.isVisible().catch(() => false)) {
      await expect(byPlaceholder).toBeVisible();
      return;
    }

    await expect(page.getByText(text)).toBeVisible();
  };

  const ensureFolderMatrixConfigured = async (page: Page) => {
    const defaultMatrixResponse = await page.request.get('/api/v1/folders/matrix/default');
    expect(defaultMatrixResponse.ok()).toBeTruthy();
    const defaultMatrixConfig = await defaultMatrixResponse.json();

    const matrixUrl = `/api/v1/folders/${FOLDER_ID}/matrix?workspace_id=${WORKSPACE_ID}`;
    const updateMatrixResponse = await page.request.put(matrixUrl, {
      data: defaultMatrixConfig,
    });
    expect(updateMatrixResponse.ok()).toBeTruthy();

    const matrixReadResponse = await page.request.get(matrixUrl);
    expect(matrixReadResponse.ok()).toBeTruthy();
    const updatedMatrix = await matrixReadResponse.json();
    expect(Array.isArray(updatedMatrix?.valueAxes)).toBeTruthy();
    expect(updatedMatrix.valueAxes.length).toBeGreaterThan(0);
  };

  test('French is the default locale on navigation labels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('link', { name: 'Accueil' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dossiers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Organisations' })).toBeVisible();
    await expect(page.getByRole('link', { name: "Cas d'usage" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Évaluation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  });

  test('language change to English persists across pages', async ({ page }) => {
    await setDashboardScope(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await waitForWorkspaceHydration(page);

    await setLanguage(page, 'en');

    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Folders' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use cases' })).toBeVisible();

    await page.goto('/organizations');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();

    await page.goto(`/folders/${FOLDER_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await openFolderNewFromFolders(page);
    await expect(page.getByText('Folder name')).toBeVisible();
    await expectFolderNamePlaceholder(page, 'Enter the folder name (optional)');
  });

  test('recently fixed labels stay translated (dashboard ROI + matrix warning + folder new labels)', async ({ page }) => {
    await setDashboardScope(page);
    await ensureFolderMatrixConfigured(page);
    await ensureFolderContextSelected(page);
    await waitForWorkspaceHydration(page);

    await ensureMatrixWarningBanner(page, 'en');

    await openFolderNewFromFolders(page);
    await expect(page.getByText('Folder name')).toBeVisible();
    await expectFolderNamePlaceholder(page, 'Enter the folder name (optional)');

    await ensureMatrixWarningBanner(page, 'fr');

    await openFolderNewFromFolders(page);
    await expect(page.getByText('Nom du dossier')).toBeVisible();
    await expectFolderNamePlaceholder(page, 'Saisir le nom du dossier (optionnel)');

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await setLanguage(page, 'en');
    await expect(page.locator('button[title="ROI quadrant configuration"]')).toBeVisible({ timeout: 15_000 });
    await setLanguage(page, 'fr');
    await expect(page.locator('button[title="Configuration du quadrant ROI"]')).toBeVisible({ timeout: 15_000 });
  });
});
