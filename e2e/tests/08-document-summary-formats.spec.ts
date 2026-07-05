import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E proof for the two owner-confirmed document-summary regressions:
 *  - BUG-3: a real .docx (one that defeats officeparser's byte-sniffing and was
 *    rejected as "Unsupported mime type … add support for zip files") must now
 *    summarize to status=ready with a non-empty summary.
 *  - BUG-4 (companion): a real .pdf must reach status=ready with a non-empty
 *    summary (the summary job is enqueued and completes, not a silent orphan).
 *
 * Watchable artifacts: trace + video are forced ON for this spec.
 */
test.use({ trace: 'on', video: 'on' });

test.describe('Documents — summary across formats (docx + pdf)', () => {
  test.describe.configure({ retries: 0 });
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  function readFixture(name: string): Buffer {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name));
  }

  test('real .docx + real .pdf upload → status ready (not "Échec") with non-empty summary', async ({ page }) => {
    test.setTimeout(360_000);
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).confirm = () => true;
    });

    // Dedicated draft folder.
    const folderName = `E2E Doc Formats ${Date.now()}`;
    const draftRes = await page.request.post(`${API_BASE_URL}/api/v1/folders/draft`, {
      data: { name: folderName, description: 'Docx + pdf summary e2e' },
    });
    expect(draftRes.ok()).toBeTruthy();
    const folderId = String((await draftRes.json().catch(() => null) as any)?.id ?? '');
    expect(folderId).toBeTruthy();

    // BUG-3 fixture: a real docx that file-type sniffs as plain "zip".
    const docxName = `report-${Date.now()}.docx`;
    const upDocx = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: {
          name: docxName,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: readFixture('sample-report.docx'),
        },
      },
    });
    expect(upDocx.ok()).toBeTruthy();
    const docxUp = await upDocx.json().catch(() => null);
    // BUG-4 guard: a summarizable upload must be enqueued, not a silent orphan.
    expect((docxUp as any)?.status).not.toBe('failed');
    expect(typeof (docxUp as any)?.job_id).toBe('string');

    // BUG-4 fixture: a real text PDF.
    const pdfName = `AM1020-${Date.now()}.pdf`;
    const upPdf = await page.request.post(`${API_BASE_URL}/api/v1/documents`, {
      multipart: {
        context_type: 'folder',
        context_id: folderId,
        file: {
          name: pdfName,
          mimeType: 'application/pdf',
          buffer: readFixture('AM1020.05.03.01-sample.pdf'),
        },
      },
    });
    expect(upPdf.ok()).toBeTruthy();
    const pdfUp = await upPdf.json().catch(() => null);
    expect((pdfUp as any)?.status).not.toBe('failed');
    expect(typeof (pdfUp as any)?.job_id).toBe('string');

    // Render the folder page and confirm both rows appear.
    await page.goto(`/folders/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10_000 });

    const rowDocx = page.locator('tbody tr').filter({ hasText: docxName }).first();
    const rowPdf = page.locator('tbody tr').filter({ hasText: pdfName }).first();
    await expect(rowDocx).toBeVisible({ timeout: 30_000 });
    await expect(rowPdf).toBeVisible({ timeout: 30_000 });

    // Poll API until BOTH reach status=ready with a non-empty summary.
    const listUrl = `${API_BASE_URL}/api/v1/documents?context_type=folder&context_id=${encodeURIComponent(folderId)}`;
    const start = Date.now();
    let docxOk = false;
    let pdfOk = false;
    while (Date.now() - start < 240_000) {
      const res = await page.request.get(listUrl);
      if (!res.ok()) {
        await page.waitForTimeout(750);
        continue;
      }
      const items: any[] = ((await res.json().catch(() => null)) as any)?.items ?? [];
      const d = items.find((it) => it.filename === docxName);
      const p = items.find((it) => it.filename === pdfName);

      // Fail fast and loud if either regressed to "Échec".
      expect(d?.status, `docx must not fail: ${d?.last_sync_error ?? ''}`).not.toBe('failed');
      expect(p?.status, `pdf must not fail: ${p?.last_sync_error ?? ''}`).not.toBe('failed');

      docxOk = d?.status === 'ready' && typeof d.summary === 'string' && d.summary.trim().length > 50;
      pdfOk = p?.status === 'ready' && typeof p.summary === 'string' && p.summary.trim().length > 50;
      if (docxOk && pdfOk) break;
      await page.waitForTimeout(1500);
    }

    expect(docxOk, 'docx summarized to ready with a non-empty summary (BUG-3)').toBeTruthy();
    expect(pdfOk, 'pdf summarized to ready with a non-empty summary (BUG-4)').toBeTruthy();

    // UI reflects "Prêt" for both.
    await expect(rowDocx).toContainText('Prêt');
    await expect(rowPdf).toContainText('Prêt');
  });
});
