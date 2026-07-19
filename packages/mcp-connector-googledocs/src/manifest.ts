/**
 * BR-72 Wave-1 benchmark proof — Google Docs connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding (taxonomy-only, independently recoded — no OOMOL code
 * vendored): OOMOL `src/providers/googledocs/actions.ts` declares 31 actions.
 * Only 5 are read-only (leading verb get/list/search, read-scope only):
 * `get_document_by_id`, `get_document_plaintext`, `export_document_as_pdf`,
 * `search_documents` (scoped by `googledocsReadScopes` — Docs readonly +
 * Drive file) and `list_spreadsheet_charts` (scoped by
 * `googledocsSheetsReadScopes` — Sheets readonly + Drive file); every other
 * action is a write (create/update/delete/insert/replace). The 6
 * capabilities below are the representative read-only subset: OOMOL's own
 * type modeling distinguishes a narrow `documentSummary` shape (id, title,
 * revision) from the full `documentDetail` shape (body, headers, footers,
 * tabs, ...) returned by `get_document_by_id` — mirrored here as two
 * granularities of the same URI-addressable single-entity resource
 * (metadata vs. content), matching the resource/tool split already used by
 * the sibling `mcp-connector-dropbox` proof (`get_metadata` vs.
 * `download_file`). The remaining 4 OOMOL read actions map 1:1 to
 * parameterized/list-category tools.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// OOMOL googledocs/scopes.ts literal values (taxonomy-only, recoded).
const GOOGLE_DOCS_READONLY_SCOPE = 'https://www.googleapis.com/auth/documents.readonly';
const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

const googledocsReadScopes = [GOOGLE_DOCS_READONLY_SCOPE, GOOGLE_DRIVE_FILE_SCOPE];
const googledocsSheetsReadScopes = [GOOGLE_SHEETS_READONLY_SCOPE, GOOGLE_DRIVE_FILE_SCOPE];

// Closed read-only gate set: no elicitation/human-confirmation/principal-gate
// is ever required for a read-only resource or a read-category tool.
const readOnlyGates: CapabilityGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

// ---------------------------------------------------------------------------
// Resources (BR-72 matrix §7 googledocs rows) — URI-addressable
// single-entity reads, by documentId, at two granularities.
// ---------------------------------------------------------------------------

const getDocumentMetadata: CapabilityResource = {
  kind: 'resource',
  name: 'get_document_metadata',
  uriTemplate: 'googledocs://documents/{documentId}/metadata',
  description: 'Read metadata (documentId, title, revisionId) for a single Google Docs document by ID.',
  requiredScopes: googledocsReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getDocumentContent: CapabilityResource = {
  kind: 'resource',
  name: 'get_document_content',
  uriTemplate: 'googledocs://documents/{documentId}',
  description: 'Read the full structural content (body, headers, footers, tabs, lists) of a single Google Docs document by ID.',
  requiredScopes: googledocsReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only) — parameterized / list / search reads.
// ---------------------------------------------------------------------------

const getDocumentPlaintext: CapabilityTool = {
  kind: 'tool',
  name: 'get_document_plaintext',
  description: 'Render a Google Docs document as best-effort plain text, with parameterized inclusion of tables/headers/footers/footnotes.',
  requiredScopes: googledocsReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string' },
      includeTables: { type: 'boolean' },
      includeHeaders: { type: 'boolean' },
      includeFooters: { type: 'boolean' },
      includeFootnotes: { type: 'boolean' },
    },
    required: ['documentId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const exportDocumentAsPdf: CapabilityTool = {
  kind: 'tool',
  name: 'export_document_as_pdf',
  description: 'Export a Google Docs file as a PDF through Google Drive.',
  requiredScopes: googledocsReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
      filename: { type: 'string' },
    },
    required: ['fileId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const searchDocuments: CapabilityTool = {
  kind: 'tool',
  name: 'search_documents',
  description: 'Search Google Docs files with Google Drive query filters.',
  requiredScopes: googledocsReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      maxResults: { type: 'number' },
      starredOnly: { type: 'boolean' },
    },
    required: [],
  },
  outputSchema: { type: 'array' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listSpreadsheetCharts: CapabilityTool = {
  kind: 'tool',
  name: 'list_spreadsheet_charts',
  description: 'List chart metadata from a Google Sheets spreadsheet.',
  requiredScopes: googledocsSheetsReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { spreadsheetId: { type: 'string' } },
    required: ['spreadsheetId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const googledocsManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'googledocs',
  version: '0.0.0',
  displayName: 'Google Docs (BR-72 read-only benchmark proof)',
  resources: [getDocumentMetadata, getDocumentContent],
  tools: [getDocumentPlaintext, exportDocumentAsPdf, searchDocuments, listSpreadsheetCharts],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [GOOGLE_DOCS_READONLY_SCOPE, GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_SHEETS_READONLY_SCOPE],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'googledocsOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description:
        'Google OAuth2 access token (authTypes: oauth2 in the OOMOL source) — principal-scoped, state-only visibility, value never disclosed.',
    },
  ],
};
