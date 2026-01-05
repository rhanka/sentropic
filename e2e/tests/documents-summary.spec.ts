import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.describe('Documents — résumés (court + long)', () => {
  test.describe.configure({ retries: 0 });
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  function readFixture(name: string): Buffer {
    const p = path.join(__dirname, 'fixtures', name);
    return fs.readFileSync(p);
  }

  test('README.md (court) + spec/*.md concat (long): upload → statut ready → résumé non vide', async ({ page }) => {
    test.setTimeout(240_000);
    // Désactiver confirm() au cas où (robustesse)
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).confirm = () => true;
    });

    // Créer un dossier draft dédié
    const folderName = `E2E Docs Summary ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: folderName, description: 'Docs summary e2e' }
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json().catch(() => null);
    const folderId = String((draftJson as any)?.id ?? '');
    expect(folderId).toBeTruthy();

    // Upload court + long via API (multipart)
    const shortName = `README-${Date.now()}.md`;
    const longName = `spec-concat-${Date.now()}.md`;

    const upShort = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: shortName, mimeType: 'text/markdown', buffer: readFixture('README.md') },
      },
    });
    expect(upShort.ok()).toBeTruthy();

    const upLong = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: longName, mimeType: 'text/markdown', buffer: readFixture('spec-concat.md') },
      },
    });
    expect(upLong.ok()).toBeTruthy();

    // Aller sur la page dossier et vérifier que les 2 lignes apparaissent
    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10_000 });

    const rowShort = page.locator('tbody tr').filter({ hasText: shortName }).first();
    const rowLong = page.locator('tbody tr').filter({ hasText: longName }).first();
    await expect(rowShort).toBeVisible({ timeout: 30_000 });
    await expect(rowLong).toBeVisible({ timeout: 30_000 });

    // Poll API jusqu’à ce que les deux documents soient ready, et que summary soit non vide
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const start = Date.now();
    let shortOk = false;
    let longOk = false;
    while (Date.now() - start < 180_000) {
      const res = await page.request.get(listUrl);
      if (!res.ok()) {
        await page.waitForTimeout(500);
        continue;
      }
      const json = await res.json().catch(() => null);
      const items: any[] = (json as any)?.items ?? [];
      const s = items.find((d) => d.filename === shortName);
      const l = items.find((d) => d.filename === longName);

      shortOk = !!s && s.status === 'ready' && typeof s.summary === 'string' && s.summary.trim().length > 50;
      longOk = !!l && l.status === 'ready' && typeof l.summary === 'string' && l.summary.trim().length > 50;
      if (shortOk && longOk) break;

      // Si l’un des deux est failed, exposer le diagnostic
      if (s?.status === 'failed' || l?.status === 'failed') {
        throw new Error(
          `document_summary failed: short=${s?.status} long=${l?.status} shortMsg=${String(s?.summary || '')} longMsg=${String(
            l?.summary || ''
          )}`
        );
      }
      await page.waitForTimeout(1000);
    }

    expect(shortOk).toBeTruthy();
    expect(longOk).toBeTruthy();

    // Vérifier côté UI que le statut "Prêt" est visible pour les deux
    await expect(rowShort).toContainText('Prêt');
    await expect(rowLong).toContainText('Prêt');
  });
});


