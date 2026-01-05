import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.describe('Documents — long get_content (résumé détaillé)', () => {
  test.describe.configure({ retries: 0 });
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  function readFixture(name: string): Buffer {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name));
  }

  test('doc long (spec concat): ready → content-text=detailed_summary ~8k–10k mots + cohérent', async ({ page }) => {
    test.setTimeout(240_000);

    // Dossier dédié
    const folderName = `E2E Docs Long ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: folderName, description: 'Docs long get_content e2e' }
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json().catch(() => null);
    const folderId = String((draftJson as any)?.id ?? '');
    expect(folderId).toBeTruthy();

    // Upload long
    const filename = `spec-long-${Date.now()}.md`;
    const upRes = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: filename, mimeType: 'text/markdown', buffer: readFixture('spec-concat.md') },
      },
    });
    expect(upRes.ok()).toBeTruthy();

    // Attendre READY via API + récupérer docId
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const startedAt = Date.now();
    let docId = '';
    while (Date.now() - startedAt < 180_000) {
      const res = await page.request.get(listUrl);
      if (res.ok()) {
        const json = await res.json().catch(() => null);
        const items: any[] = (json as any)?.items ?? [];
        const doc = items.find((d) => d.filename === filename);
        if (doc) {
          docId = String(doc.id || '');
          if (doc.status === 'ready') break;
          if (doc.status === 'failed') throw new Error(`document_summary failed: ${String(doc.summary || '')}`);
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(docId).toBeTruthy();

    // Equivalent "documents.get_content": endpoint read-only qui expose le résumé détaillé persistant
    const contentRes = await page.request.get(`${API_BASE_URL}/api/v1/documents/${encodeURIComponent(docId)}/content-text`);
    expect(contentRes.ok()).toBeTruthy();
    const contentJson = await contentRes.json().catch(() => null);

    expect((contentJson as any)?.kind).toBe('detailed_summary');
    const content = String((contentJson as any)?.content ?? '');
    const words = Number((contentJson as any)?.content_words ?? 0);

    expect(content.length).toBeGreaterThan(10_000);
    // Garder une marge (selon heuristique/chunking) tout en restant dans l'objectif produit.
    expect(words).toBeGreaterThan(7_000);
    expect(words).toBeLessThan(12_000);

    // Vérifier des marqueurs "cohérents" présents dans la spec/README (non fragile)
    const lc = content.toLowerCase();
    expect(lc).toContain('svelte');
    expect(lc).toContain('postgres');
    expect(lc).toContain('queue');
  });
});


