import { test, expect } from '@playwright/test';

test.describe('Gestion des cas d\'usage', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

  const waitForUseCaseInApi = async (page: any, folderId: string, useCaseId: string, timeoutMs = 30_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const res = await page.request.get(`${API_BASE_URL}/api/v1/use-cases?folder_id=${encodeURIComponent(folderId)}`);
      if (res.ok()) {
        const body = await res.json().catch(() => null);
        const items: any[] = (body as any)?.items ?? [];
        if (items.some((uc) => String(uc?.id ?? '') === useCaseId)) return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error(`Use case ${useCaseId} introuvable via API après ${timeoutMs}ms`);
  };

  test('redirige /cas-usage vers la nouvelle liste /dossiers (ou /dossiers/[id])', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL(/\/dossiers(\/[^/]+)?$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/dossiers(\/[^/]+)?$/);
  });

  test('affiche la liste de cas d’usage sur /dossiers/[id] et permet d’ouvrir un détail', async ({ page }) => {
    // IMPORTANT: le suite E2E contient des tests destructifs (suppression dossiers).
    // Pour éviter la dépendance au seed global et les flaky, on crée un dossier + un cas d’usage dédiés.
    const folderName = `E2E UseCases ${Date.now()}`;
    const createFolderRes = await page.request.post(`${API_BASE_URL}/api/v1/folders`, {
      data: { name: folderName, description: 'Folder created by usecase.spec.ts' }
    });
    expect(createFolderRes.ok()).toBeTruthy();
    const createdFolder = await createFolderRes.json();
    const folderId = String(createdFolder?.id || '');
    expect(folderId).toBeTruthy();

    const useCaseName = `UC ${Date.now()}`;
    const createUseCaseRes = await page.request.post(`${API_BASE_URL}/api/v1/use-cases`, {
      data: { name: useCaseName, description: 'Use case created by usecase.spec.ts', folderId }
    });
    expect(createUseCaseRes.ok()).toBeTruthy();
    const createdUseCase = await createUseCaseRes.json();
    const useCaseId = String(createdUseCase?.id || '');
    expect(useCaseId).toBeTruthy();

    // Stabiliser: attendre que l’API liste bien le cas d’usage (évite les flakys en charge)
    await waitForUseCaseInApi(page, folderId, useCaseId, 30_000);

    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');

    // La liste des cas d’usage est sur la page dossier
    const useCaseCard = page.locator('article.rounded.border.border-slate-200').filter({ hasText: useCaseName }).first();
    await expect(useCaseCard).toBeVisible({ timeout: 30_000 });

    await Promise.all([
      page.waitForURL(new RegExp(`/cas-usage/${useCaseId}$`), { timeout: 10_000 }),
      useCaseCard.click()
    ]);
    expect(page.url()).toMatch(new RegExp(`/cas-usage/${useCaseId}$`));
  });
});
