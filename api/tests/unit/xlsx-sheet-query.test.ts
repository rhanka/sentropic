import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractXlsxSheets, isXlsxDocument } from '../../src/services/document-text';

/**
 * Workbook used by the query-tool sheet awareness:
 * - "Inputs": two numeric rows.
 * - "Totals": a cross-sheet formula referencing Inputs cells, with a precomputed result.
 */
async function createWorkbookBytes(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  const inputs = wb.addWorksheet('Inputs');
  inputs.addRow(['Item', 'Amount']);
  inputs.addRow(['Alpha', 10]);
  inputs.addRow(['Beta', 32]);

  const totals = wb.addWorksheet('Totals');
  totals.addRow(['Label', 'Value']);
  totals.getCell('A2').value = 'Sum';
  totals.getCell('B2').value = { formula: 'Inputs!B2+Inputs!B3', result: 42 };

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

describe('xlsx sheet query helpers', () => {
  it('detects xlsx documents by mime type and extension', () => {
    expect(
      isXlsxDocument('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x.bin'),
    ).toBe(true);
    expect(isXlsxDocument('application/octet-stream', 'report.XLSX')).toBe(true);
    expect(isXlsxDocument('application/pdf', 'report.pdf')).toBe(false);
  });

  it('lists every non-empty sheet with name, 1-based index, and row count', async () => {
    const sheets = await extractXlsxSheets(await createWorkbookBytes());

    expect(sheets.map((s) => ({ name: s.name, index: s.index, rowCount: s.rowCount }))).toEqual([
      { name: 'Inputs', index: 1, rowCount: 3 },
      { name: 'Totals', index: 2, rowCount: 2 },
    ]);
  });

  it('selects a sheet by name and surfaces its content', async () => {
    const sheets = await extractXlsxSheets(await createWorkbookBytes());
    const byName = sheets.find((s) => s.name === 'Inputs');

    expect(byName).toBeDefined();
    expect(byName?.text).toContain('Item\tAmount');
    expect(byName?.text).toContain('Alpha\t10');
    expect(byName?.text).toContain('Beta\t32');
  });

  it('selects a sheet by 1-based index and surfaces formula + computed value', async () => {
    const sheets = await extractXlsxSheets(await createWorkbookBytes());
    const byIndex = sheets.find((s) => s.index === 2);

    expect(byIndex?.name).toBe('Totals');
    // Formula preserved verbatim (cross-sheet Sheet!A1 semantics) AND computed value shown.
    expect(byIndex?.text).toContain('Sum\t=Inputs!B2+Inputs!B3 → 42');
  });
});
