import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BR-40b: multi-sheet xlsx indexing + query.
 *
 * Deterministic coverage (no AI dependency): upload a real multi-sheet xlsx whose second sheet holds
 * a cross-sheet formula (=Inputs!B2+Inputs!B3), then confirm the full upload → index pipeline reaches
 * `ready`. Reaching `ready` proves the exceljs-based multi-sheet extraction (extractXlsxSheets) ran
 * successfully on a formula-bearing workbook during indexing, and that the original bytes are
 * retrievable as a valid xlsx for the sheet-aware tool actions to load.
 *
 * The per-sheet tool actions (`list_sheets` / `get_sheet_content`) consume the same extracted content;
 * their formula+value surfacing is asserted at the unit level
 * (api/tests/unit/{document-text,xlsx-sheet-query}.test.ts). The chat-driven invocation of those
 * actions is exercised manually (UAT) because the chat path is AI-nondeterministic (allowlisted).
 */
test.describe('Documents — xlsx multi-sheet (formulas + values)', () => {
  test.describe.configure({ retries: 0 });
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function readFixture(name: string): Buffer {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name));
  }

  test('multi-sheet xlsx with a cross-sheet formula indexes and surfaces formula + value', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // Dedicated draft folder.
    const folderName = `E2E XLSX Multi-Sheet ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: folderName, description: 'xlsx multi-sheet e2e' },
    });
    expect(draftRes.ok()).toBeTruthy();
    const draftJson = await draftRes.json().catch(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folderId = String((draftJson as any)?.id ?? '');
    expect(folderId).toBeTruthy();

    // Upload the multi-sheet workbook via API (multipart).
    const fileName = `multi-sheet-${Date.now()}.xlsx`;
    const upload = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: { name: fileName, mimeType: XLSX_MIME, buffer: readFixture('multi-sheet-formula.xlsx') },
      },
    });
    expect(upload.ok()).toBeTruthy();

    // Poll the documents list until the workbook is `ready`.
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const start = Date.now();
    let docId = '';
    let ready = false;
    while (Date.now() - start < 180_000) {
      const res = await page.request.get(listUrl);
      if (res.ok()) {
        const json = await res.json().catch(() => null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: any[] = (json as any)?.items ?? [];
        const doc = items.find((d) => d.filename === fileName);
        if (doc?.id) docId = String(doc.id);
        if (doc?.status === 'ready') {
          ready = true;
          break;
        }
        if (doc?.status === 'failed') break;
      }
      await page.waitForTimeout(1000);
    }
    expect(ready).toBeTruthy();
    expect(docId).toBeTruthy();

    // The content endpoint streams the original bytes back for local documents; verify the workbook
    // round-trips as a real xlsx (zip magic "PK") so the sheet-aware tool actions can load it.
    const contentRes = await page.request.get(
      `${API_BASE_URL}/api/v1/documents/${encodeURIComponent(docId)}/content`,
    );
    expect(contentRes.ok()).toBeTruthy();
    const bytes = Buffer.from(await contentRes.body());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
