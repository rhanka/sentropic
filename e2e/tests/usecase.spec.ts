import { test, expect, request } from '@playwright/test';

test.describe('Gestion des cas d\'usage', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAId = '';
  let folderId = '';
  let useCaseId = '';
  let useCaseName = '';
  let userBId = '';

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
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en viewer (status ${addRes.status()})`);
    }

    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceAId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userB = members.find((member) => member.email === 'e2e-user-b@example.com');
    if (!userB) throw new Error('User B introuvable dans les membres du workspace A');
    userBId = userB.userId;

    const foldersRes = await userAApi.get('/api/v1/folders');
    if (!foldersRes.ok()) throw new Error(`Impossible de charger les dossiers (status ${foldersRes.status()})`);
    const foldersData = await foldersRes.json().catch(() => null);
    const folders: Array<{ id: string }> = foldersData?.items ?? [];
    if (!folders.length) throw new Error('Aucun dossier trouvé pour Workspace A');
    folderId = folders[0].id;

    const useCasesRes = await userAApi.get(`/api/v1/use-cases?folder_id=${encodeURIComponent(folderId)}`);
    if (!useCasesRes.ok()) throw new Error(`Impossible de charger les cas d'usage (status ${useCasesRes.status()})`);
    const useCasesData = await useCasesRes.json().catch(() => null);
    const useCases: Array<{ id: string; name?: string }> = useCasesData?.items ?? [];
    if (!useCases.length) throw new Error('Aucun cas d\'usage trouvé pour le dossier Workspace A');
    useCaseId = useCases[0].id;
    useCaseName = useCases[0].name || '';

    await userAApi.dispose();
  });

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

  test.describe('Read-only (viewer)', () => {
    test.use({ storageState: USER_B_STATE });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((id: string) => {
        try {
          localStorage.setItem('workspaceScopeId', id);
        } catch {
          // ignore
        }
      }, workspaceAId);
    });

    test('liste: consulter sans actions d’édition', async ({ page }) => {
      await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
      await page.waitForLoadState('domcontentloaded');

      if (useCaseName) {
        const useCaseCard = page.locator('article.rounded.border.border-slate-200').filter({ hasText: useCaseName }).first();
        await expect(useCaseCard).toBeVisible({ timeout: 10_000 });
      }

      const deleteButtons = page.locator('button[title="Supprimer le cas d\'usage"], button:has-text("Supprimer le cas d\'usage")');
      await expect(deleteButtons).toHaveCount(0);
    });

    test('détail: champs non éditables', async ({ page }) => {
      await page.goto(`/cas-usage/${encodeURIComponent(useCaseId)}`);
      await page.waitForLoadState('domcontentloaded');

      const disabledField = page.locator('.editable-input:disabled, .editable-textarea:disabled').first();
      await expect(disabledField).toBeVisible({ timeout: 10_000 });

      const deleteButton = page.locator('button[title="Supprimer le cas d\'usage"]');
      await expect(deleteButton).toHaveCount(0);
    });
  });

  test('User A change le rôle de User B → User B se met à jour sans reload', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const setViewer = await userAApi.patch(`/api/v1/workspaces/${workspaceAId}/members/${userBId}`, {
      data: { role: 'viewer' },
    });
    if (!setViewer.ok()) throw new Error(`Impossible de repasser User B en viewer (status ${setViewer.status()})`);

    const userBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageB = await userBContext.newPage();
    await pageB.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
    }, workspaceAId);
    await pageB.goto(`/cas-usage/${encodeURIComponent(useCaseId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    const editableField = pageB.locator('.editable-input, .editable-textarea').first();
    await expect(editableField).toBeDisabled({ timeout: 10_000 });

    const setEditor = await userAApi.patch(`/api/v1/workspaces/${workspaceAId}/members/${userBId}`, {
      data: { role: 'editor' },
    });
    if (!setEditor.ok()) throw new Error(`Impossible de passer User B en editor (status ${setEditor.status()})`);

    await expect(editableField).toBeEnabled({ timeout: 10_000 });

    await userBContext.close();
    await userAApi.dispose();
  });
});
