import { test, expect, type Page } from '@playwright/test';

test.describe('Internationalization reliability', () => {
  test.use({ storageState: './.auth/user-a.json' });

  const WORKSPACE_ID = 'e2e-ws-a';
  const FOLDER_ID = 'e2e-folder-a';

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

    await page.goto('/folder/new');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Folder name')).toBeVisible();
    await expect(page.getByPlaceholder('Enter the folder name (optional)')).toBeVisible();
  });

  test('recently fixed labels stay translated (dashboard ROI + matrix warning + folder new labels)', async ({ page }) => {
    await setDashboardScope(page);
    await ensureFolderMatrixConfigured(page);

    await page.goto(`/folders/${FOLDER_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await setLanguage(page, 'en');
    await expect(page.locator('button[title="ROI quadrant configuration"]')).toBeVisible({ timeout: 15_000 });

    await page.goto('/matrix');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page
        .getByText('Warning: changing weights will automatically recalculate all scores for your existing use cases.')
        .or(page.getByText('No matrix configured for this folder'))
        .first()
    ).toBeVisible({ timeout: 15_000 });

    await page.goto('/folder/new');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Folder name')).toBeVisible();
    await expect(page.getByPlaceholder('Enter the folder name (optional)')).toBeVisible();

    await setLanguage(page, 'fr');
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button[title="Configuration du quadrant ROI"]')).toBeVisible({ timeout: 15_000 });

    await page.goto('/matrix');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page
        .getByText("Attention : Modifier les poids recalculera automatiquement tous les scores de vos cas d'usage existants.")
        .or(page.getByText('Aucune matrice configurée pour ce dossier'))
        .first()
    ).toBeVisible({ timeout: 15_000 });

    await page.goto('/folder/new');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Nom du dossier')).toBeVisible();
    await expect(page.getByPlaceholder('Saisir le nom du dossier (optionnel)')).toBeVisible();
  });
});
