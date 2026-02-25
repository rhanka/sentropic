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

  test('README.md (court) + spec-concat.md (long): upload → statut ready → résumés non vides (long: ready ou failed si trop court)', async ({ page }) => {
    test.setTimeout(360_000);
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
    const longName = `spec-long-${Date.now()}.md`;

    const upShort = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: shortName, mimeType: 'text/markdown', buffer: readFixture('README.md') },
      },
    });
    expect(upShort.ok()).toBeTruthy();

    const longBuf = readFixture('spec-concat.md');
    const longPayload = longBuf.length > 50_000 ? longBuf.subarray(0, 50_000) : longBuf;
    const upLong = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: longName, mimeType: 'text/markdown', buffer: longPayload },
      },
    });
    expect(upLong.ok()).toBeTruthy();

    // Aller sur la page dossier et vérifier que les 2 lignes apparaissent
    await page.goto(`/folders/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10_000 });

    const rowShort = page.locator('tbody tr').filter({ hasText: shortName }).first();
    const rowLong = page.locator('tbody tr').filter({ hasText: longName }).first();
    await expect(rowShort).toBeVisible({ timeout: 30_000 });
    await expect(rowLong).toBeVisible({ timeout: 30_000 });

    // Poll API jusqu’à ce que:
    // - le doc court soit `ready` avec un résumé non vide
    // - le doc long soit `ready` OU `failed` si (et seulement si) le résumé détaillé est trop court
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const start = Date.now();
    let shortOk = false;
    let longOk = false;
    let longId = '';
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
      if (l?.id) longId = String(l.id);

      if (l?.status === 'ready') {
        longOk = typeof l.summary === 'string' && l.summary.trim().length > 50;
      } else if (l?.status === 'failed' && longId) {
        // Échec accepté uniquement si la cause est "Résumé détaillé insuffisant".
        // Ne pas relancer de génération (pas d'appel "content-text"): on lit l'erreur du job via job_id.
        const jobId = String(l?.job_id ?? '');
        if (jobId) {
          const jobRes = await page.request.get(`${API_BASE_URL}/api/v1/queue/jobs/${encodeURIComponent(jobId)}`);
          if (jobRes.ok()) {
            const jobJson = await jobRes.json().catch(() => null);
            const err = String((jobJson as any)?.error ?? '');
            if (err.includes('Résumé détaillé insuffisant')) longOk = true;
          }
        }
      }

      if (shortOk && longOk) break;
      await page.waitForTimeout(1000);
    }

    expect(shortOk).toBeTruthy();
    expect(longOk).toBeTruthy();

    // Vérifier côté UI que le statut "Prêt" est visible
    await expect(rowShort).toContainText('Prêt');
    // Long doc: soit "Prêt" soit "Échec" (mais uniquement si échec pour résumé détaillé trop court)
    await expect(rowLong).toContainText(/Prêt|Échec/);
  });

});


