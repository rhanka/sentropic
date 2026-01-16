import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.describe('Documents — UI actions (icônes + suppression)', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  function readFixture(name: string): Buffer {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name));
  }

  test.beforeEach(async ({ page }) => {
    // Assurer un scope admin "normal" (pas read-only) et éviter les confirm() natifs (flaky).
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('workspaceScopeId', id);
      } catch {
        // ignore
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).confirm = () => true;
      } catch {
        // ignore
      }
    }, ADMIN_WORKSPACE_ID);
  });

  test('ordre + styles icônes ; suppression via UI supprime vraiment le document', async ({ page }) => {
    test.setTimeout(180_000);

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
    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
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
  });
});


