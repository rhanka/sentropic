import { test, expect, request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Documents — UI actions (icônes + suppression)', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
  const ADMIN_STATE = './.auth/state.json';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAId = '';
  let workspaceBId = '';
  let organizationAId = '';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  function readFixture(name: string): Buffer {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name));
  }

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });

    // Créer deux workspaces uniques pour ce fichier de test (isolation des ressources)
    // Workspace A pour User A
    const workspaceAName = `Documents Workspace A E2E ${Date.now()}`;
    const createARes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceAName } });
    if (!createARes.ok()) throw new Error(`Impossible de créer workspace A (status ${createARes.status()})`);
    const createdA = await createARes.json().catch(() => null);
    workspaceAId = String(createdA?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Workspace B pour User B
    const workspaceBName = `Documents Workspace B E2E ${Date.now()}`;
    const createBRes = await userBApi.post('/api/v1/workspaces', { data: { name: workspaceBName } });
    if (!createBRes.ok()) throw new Error(`Impossible de créer workspace B (status ${createBRes.status()})`);
    const createdB = await createBRes.json().catch(() => null);
    workspaceBId = String(createdB?.id || '');
    if (!workspaceBId) throw new Error('workspaceBId introuvable');

    // Ajouter user-b en editor dans Workspace A pour les tests
    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'editor' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en editor (status ${addRes.status()})`);
    }

    // Créer une organisation dans Workspace A pour les tests
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    const orgItems: Array<{ id: string }> = orgJson ? [{ id: String(orgJson.id || '') }] : [];
    if (!orgItems.length) throw new Error('Aucune organisation Workspace A');
    organizationAId = orgItems[0].id;

    await userAApi.dispose();
    await userBApi.dispose();
  });

  test('ordre + styles icônes ; suppression via UI supprime vraiment le document', async ({ browser }) => {
    test.setTimeout(180_000);
    const adminContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(ADMIN_STATE, ADMIN_WORKSPACE_ID),
    });
    const page = await adminContext.newPage();
    await page.addInitScript(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).confirm = () => true;
      } catch {
        // ignore
      }
    });

    try {
      // 1) Créer un dossier draft dédié
      const folderName = `E2E Docs UI ${Date.now()}`;
      const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
        data: { name: folderName, description: 'Docs UI actions e2e' }
      });
      expect(draftRes.ok()).toBeTruthy();
      const draftJson = await draftRes.json().catch(() => null);
      const folderId = String((draftJson as any)?.id ?? '');
      expect(folderId).toBeTruthy();

    // 2) Upload d’un doc "court" (README fixture) via API (multipart)
    const filename = `README-ui-${Date.now()}.md`;
    const upRes = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: filename, mimeType: 'text/markdown', buffer: readFixture('README.md') },
      },
    });
    expect(upRes.ok()).toBeTruthy();

    // 3) Attendre que le doc soit ready via API (et récupérer docId)
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const start = Date.now();
    let docId = '';
    while (Date.now() - start < 120_000) {
      const res = await page.request.get(listUrl);
      if (res.ok()) {
        const json = await res.json().catch(() => null);
        const items: any[] = (json as any)?.items ?? [];
        const doc = items.find((d) => d.filename === filename);
        if (doc) {
          docId = String(doc.id || '');
          if (doc.status === 'ready') break;
          if (doc.status === 'failed') {
            throw new Error(`document_summary failed: ${String(doc.summary || '')}`);
          }
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(docId).toBeTruthy();

    // 4) Aller sur la page dossier et cibler la ligne du document
    await page.goto(`/folders/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10_000 });

    const docRow = page.locator('tbody tr').filter({
      has: page.locator('div.font-medium', { hasText: filename }),
    });
    await expect(docRow).toBeVisible({ timeout: 30_000 });
    await expect(docRow).toContainText('Prêt');

    // 5) Ordre & styles des icônes (dans la ligne)
    const rowButtons = docRow.locator('button');
    await expect(rowButtons).toHaveCount(3);

    const btn0 = rowButtons.nth(0); // œil / afficher/masquer résumé
    const btn1 = rowButtons.nth(1); // download
    const deleteBtn = docRow.getByRole('button', { name: 'Supprimer' }); // delete

    // Ordre (libellés FR)
    await expect(btn1).toHaveAttribute('aria-label', 'Télécharger');
    await expect(deleteBtn).toHaveAttribute('aria-label', 'Supprimer');

    // Styles: primary pour œil & download, warning pour poubelle
    await expect(btn0).toHaveClass(/text-primary/);
    await expect(btn0).toHaveClass(/hover:bg-slate-100/);
    await expect(btn1).toHaveClass(/text-primary/);
    await expect(btn1).toHaveClass(/hover:bg-slate-100/);
    await expect(deleteBtn).toHaveClass(/text-warning/);
    await expect(deleteBtn).toHaveClass(/hover:bg-slate-100/);

    // 6) Replier/ouvrir le résumé pour s'assurer que le bouton œil marche (plein largeur)
    await btn0.click();
    const summaryRow = page.locator('tbody tr').filter({ has: page.locator('td[colspan="6"]') }).first();
    await expect(summaryRow).toBeVisible({ timeout: 10_000 });
    await expect(summaryRow.locator('td[colspan="6"]')).toBeVisible();
    await btn0.click();
    await expect(summaryRow).toHaveCount(0, { timeout: 10_000 });

    // 7) Suppression via UI: confirmer que confirm() est bien bypass (sinon aucun DELETE ne part)
    const confirmOk = await page.evaluate(() => window.confirm('test'));
    expect(confirmOk).toBeTruthy();

    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.scrollIntoViewIfNeeded();
    await deleteBtn.click({ force: true });

    // Toast attendu (succès ou erreur). Important pour diagnostiquer les échecs silencieux.
    const toast = page.getByRole('alert').first();
    try {
      await toast.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      // si aucun toast n’apparaît, continuer quand même: on validera par l’API (source de vérité)
    }
    const toastText = (await toast.textContent().catch(() => null)) || '';

    // Poll API: source de vérité
    const delStart = Date.now();
    while (Date.now() - delStart < 30_000) {
      const afterRes = await page.request.get(listUrl);
      if (afterRes.ok()) {
        const afterJson = await afterRes.json().catch(() => null);
        const afterItems: any[] = (afterJson as any)?.items ?? [];
        if (!afterItems.find((d) => d.id === docId)) break;
      }
      await page.waitForTimeout(500);
    }

    const finalRes = await page.request.get(listUrl);
    expect(finalRes.ok()).toBeTruthy();
    const finalJson = await finalRes.json().catch(() => null);
    const finalItems: any[] = (finalJson as any)?.items ?? [];
    if (finalItems.find((d) => d.id === docId)) {
      throw new Error(`Document toujours présent après suppression UI. Dernier toast: ${toastText || 'none'}`);
    }

    // Et la ligne disparaît en UI (reload pour refléter)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
      await expect(docRow).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await adminContext.close();
    }
  });

  test('documents scoping: User B voit le doc en workspace A, pas en workspace B', async ({ browser }) => {
    test.setTimeout(180_000);

    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userBApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_B_STATE });
    const workspaceQueryA = `?workspace_id=${workspaceAId}`;
    const workspaceQueryB = `?workspace_id=${workspaceBId}`;

    const filename = `README-org-${Date.now()}.md`;
    const uploadRes = await userAApi.post(`/api/v1/documents${workspaceQueryA}`, {
      multipart: {
        context_type: 'organization',
        context_id: organizationAId,
        file: { name: filename, mimeType: 'text/markdown', buffer: readFixture('README.md') },
      },
    });
    expect(uploadRes.ok()).toBeTruthy();

    const listUrlA = `${API_BASE_URL}/api/v1/documents${workspaceQueryA}&context_type=organization&context_id=${encodeURIComponent(organizationAId)}`;
    const start = Date.now();
    let docId = '';
    while (Date.now() - start < 60_000) {
      const res = await userBApi.get(listUrlA);
      if (res.ok()) {
        const json = await res.json().catch(() => null);
        const items: any[] = (json as any)?.items ?? [];
        const doc = items.find((d) => d.filename === filename);
        if (doc) {
          docId = String(doc.id || '');
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(docId).toBeTruthy();

    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
    });
    const pageB = await userBContext.newPage();
    await pageB.goto(`/organizations/${encodeURIComponent(organizationAId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await expect(pageB.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10_000 });
    const docRow = pageB.locator('tbody tr').filter({
      has: pageB.locator('div.font-medium', { hasText: filename }),
    });
    await expect(docRow).toBeVisible({ timeout: 20_000 });

    const listUrlB = `${API_BASE_URL}/api/v1/documents${workspaceQueryB}&context_type=organization&context_id=${encodeURIComponent(organizationAId)}`;
    const otherRes = await userBApi.get(listUrlB);
    if (otherRes.ok()) {
      const otherJson = await otherRes.json().catch(() => null);
      const otherItems: any[] = (otherJson as any)?.items ?? [];
      if (otherItems.find((d) => d.id === docId)) {
        throw new Error('Document visible en workspace B alors qu’il ne devrait pas');
      }
    } else {
      expect([403, 404]).toContain(otherRes.status());
    }

    await userBContext.close();
    await userAApi.dispose();
    await userBApi.dispose();
  });
});


