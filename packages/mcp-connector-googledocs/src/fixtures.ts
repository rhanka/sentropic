/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC Google Docs fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const PDF_PLACEHOLDER_TEXT = '%PDF-1.4 Synthetic demo Google Docs PDF export fixture.\n';
const PDF_PLACEHOLDER_BASE64 = Buffer.from(PDF_PLACEHOLDER_TEXT, 'utf8').toString('base64');
const PLAINTEXT_CONTENT = 'Synthetic demo Google Docs content.\n';

export const googledocsFixtures = {
  resources: {
    get_document_metadata: {
      documentId: 'demoDocId0001',
      title: 'Sentropic Demo Document',
      revisionId: 'ALm37BU_demo0001',
    },
    get_document_content: {
      documentId: 'demoDocId0001',
      title: 'Sentropic Demo Document',
      revisionId: 'ALm37BU_demo0001',
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: PLAINTEXT_CONTENT } }],
            },
          },
        ],
      },
      headers: {},
      footers: {},
      footnotes: {},
      tabs: [],
      documentStyle: {},
      namedRanges: {},
      inlineObjects: {},
      lists: {},
    },
  },
  tools: {
    get_document_plaintext: {
      documentId: 'demoDocId0001',
      title: 'Sentropic Demo Document',
      text: PLAINTEXT_CONTENT,
    },
    export_document_as_pdf: {
      fileId: 'demoDocId0001',
      filename: 'sentropic-demo-document.pdf',
      mimeType: 'application/pdf',
      dataBase64: PDF_PLACEHOLDER_BASE64,
      sizeBytes: Buffer.byteLength(PDF_PLACEHOLDER_TEXT, 'utf8'),
    },
    search_documents: {
      documents: [
        {
          id: 'demoDocId0001',
          name: 'Sentropic Demo Document',
          mimeType: 'application/vnd.google-apps.document',
          webViewLink: 'https://docs.google.com/document/d/demoDocId0001/edit',
          createdTime: '2026-06-01T12:00:00Z',
          modifiedTime: '2026-07-01T12:00:00Z',
          driveId: null,
          parents: ['demoFolderId0001'],
          owners: [
            {
              displayName: 'Sentropic Demo User',
              emailAddress: 'demo-user@example.invalid',
              permissionId: 'demoPermissionId0001',
              photoLink: null,
            },
          ],
          shared: true,
          starred: false,
          trashed: false,
        },
      ],
      nextPageToken: null,
    },
    list_spreadsheet_charts: {
      spreadsheetId: 'demoSheetId0001',
      title: 'Sentropic Demo Spreadsheet',
      sheets: [
        {
          sheetId: 0,
          title: 'Sheet1',
          charts: [{ chartId: 1000001, spec: { title: 'Demo Chart' } }],
        },
      ],
    },
  },
} as const;

export type GoogledocsResourceCapabilityName = keyof typeof googledocsFixtures.resources;
export type GoogledocsToolCapabilityName = keyof typeof googledocsFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (googledocsFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (googledocsFixtures.tools as Record<string, unknown>)[capabilityRef];
}
