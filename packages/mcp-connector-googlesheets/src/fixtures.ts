/**
 * BR-72 read-only benchmark proof — SYNTHETIC Google Sheets fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

export const googlesheetsFixtures = {
  resources: {
    get_spreadsheet_info: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      title: 'Sentropic Demo Ledger',
      sheets: [
        { sheetId: 0, title: 'Overview', index: 0, sheetType: 'GRID', hidden: false },
        { sheetId: 111, title: 'Transactions', index: 1, sheetType: 'GRID', hidden: false },
      ],
    },
    get_sheet_names: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      sheetNames: ['Overview', 'Transactions'],
      sheetIdByName: { Overview: 0, Transactions: 111 },
    },
    values_get: {
      range: 'Overview!A1:B3',
      majorDimension: 'ROWS',
      values: [
        ['Metric', 'Value'],
        ['Total rows', '42'],
        ['Last sync', '2026-07-01T00:00:00.000Z'],
      ],
    },
  },
  tools: {
    search_spreadsheets: {
      spreadsheets: [
        {
          id: 'synthetic-spreadsheet-0001',
          name: 'Sentropic Demo Ledger',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          shared: false,
          starred: false,
          trashed: false,
        },
      ],
      totalFound: 1,
      nextPageToken: null,
    },
    batch_get: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      valueRanges: [
        {
          range: 'Overview!A1:B3',
          majorDimension: 'ROWS',
          values: [
            ['Metric', 'Value'],
            ['Total rows', '42'],
          ],
        },
        {
          range: 'Transactions!A1:C2',
          majorDimension: 'ROWS',
          values: [
            ['Date', 'Amount', 'Note'],
            ['2026-07-01', '100', 'Synthetic demo row'],
          ],
        },
      ],
    },
    get_conditional_format_rules: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      sheets: [
        {
          sheetId: 111,
          conditionalFormats: [
            { booleanRule: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '1000' }] } } },
          ],
        },
      ],
    },
    get_data_validation_rules: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      rules: [
        {
          range: 'Transactions!B2:B100',
          condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
        },
      ],
    },
    search_developer_metadata: {
      spreadsheetId: 'synthetic-spreadsheet-0001',
      matchedDeveloperMetadata: [
        {
          developerMetadata: { metadataId: 900001, metadataKey: 'demo-key', metadataValue: 'demo-value' },
        },
      ],
    },
  },
} as const;

export type GooglesheetsResourceCapabilityName = keyof typeof googlesheetsFixtures.resources;
export type GooglesheetsToolCapabilityName = keyof typeof googlesheetsFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (googlesheetsFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (googlesheetsFixtures.tools as Record<string, unknown>)[capabilityRef];
}
