import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractDocumentInfoFromDocument, extractXlsxSheets } from '../../src/services/document-text';

/**
 * Builds a 2-sheet workbook:
 * - "Budget": header + two data rows of numbers.
 * - "Roadmap": labels + a cross-sheet formula cell (=Budget!B2+Budget!B3) with a precomputed result,
 *   to prove the extractor surfaces BOTH the formula text and the computed value.
 */
async function createWorkbookBytes(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  const budget = wb.addWorksheet('Budget');
  budget.addRow(['Department', 'Q1', 'Q2']);
  budget.addRow(['Support', 120, 150]);
  budget.addRow(['Sales', 200, 225]);

  const roadmap = wb.addWorksheet('Roadmap');
  roadmap.addRow(['Milestone', 'Owner']);
  roadmap.addRow(['Launch', 'Alice']);
  // Formula cell with a precomputed result (exceljs does not evaluate formulas on load).
  roadmap.getCell('A3').value = { formula: 'Budget!B2+Budget!B3', result: 320 };

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

describe('document text extraction', () => {
  it('extracts readable text from every XLSX worksheet', async () => {
    const extracted = await extractDocumentInfoFromDocument({
      bytes: await createWorkbookBytes(),
      filename: 'planning.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(extracted.text).toContain('Sheet: Budget');
    expect(extracted.text).toContain('Department\tQ1\tQ2');
    expect(extracted.text).toContain('Support\t120\t150');
    expect(extracted.text).toContain('Sheet: Roadmap');
    expect(extracted.text).toContain('Milestone\tOwner');
    expect(extracted.text).toContain('Launch\tAlice');
    expect(extracted.metadata.title).toBe('planning.xlsx');
    expect(extracted.metadata.words).toBeGreaterThan(5);
    expect(extracted.headingsH1).toEqual(['Budget', 'Roadmap']);
  });

  it('surfaces both the formula text and the computed value for formula cells', async () => {
    const extracted = await extractDocumentInfoFromDocument({
      bytes: await createWorkbookBytes(),
      filename: 'planning.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Cross-sheet formula preserved verbatim AND its computed value shown.
    expect(extracted.text).toContain('=Budget!B2+Budget!B3 → 320');
  });

  it('returns structured per-sheet content via extractXlsxSheets', async () => {
    const sheets = await extractXlsxSheets(await createWorkbookBytes());

    expect(sheets.map((s) => s.name)).toEqual(['Budget', 'Roadmap']);
    expect(sheets.map((s) => s.index)).toEqual([1, 2]);

    const budget = sheets.find((s) => s.name === 'Budget');
    expect(budget?.rowCount).toBe(3);
    expect(budget?.text).toContain('Department\tQ1\tQ2');
    expect(budget?.text).not.toContain('Sheet: Budget'); // structured text has no label header

    const roadmap = sheets.find((s) => s.name === 'Roadmap');
    expect(roadmap?.rowCount).toBe(3);
    expect(roadmap?.text).toContain('=Budget!B2+Budget!B3 → 320');
  });
});
