/**
 * BR-72 read-only benchmark proof — Google Sheets connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package.
 * This is a recoded proof against the Sentropic `@sentropic/mcp-platform`
 * contract (see `../../mcp-platform/src/manifest.ts`), not the production
 * connector. Capabilities are taxonomy-grounded in the OOMOL `googlesheets`
 * provider's read-only action set (`values_get`, `batch_get`,
 * `search_spreadsheets`, `get_spreadsheet_info`, `get_sheet_names`,
 * `get_conditional_format_rules`, `get_data_validation_rules`,
 * `search_developer_metadata`) but recoded independently — no OOMOL code
 * is vendored or wrapped.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// Closed read-only gate set: no elicitation/human-confirmation/principal-gate
// is ever required for a read-only resource or a read-category tool.
const readOnlyGates: CapabilityGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

// Both OOMOL Google Sheets/Drive readonly OAuth scopes, shared by every
// read action in the OOMOL provider's `googlesheetsReadScopes` constant.
const readScopes = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

// ---------------------------------------------------------------------------
// Resources (URI-addressable single-entity reads)
// ---------------------------------------------------------------------------

const getSpreadsheetInfo: CapabilityResource = {
  kind: 'resource',
  name: 'get_spreadsheet_info',
  uriTemplate: 'googlesheets://spreadsheets/{spreadsheetId}',
  description: 'Read spreadsheet metadata (title, sheet index) for a single spreadsheet by ID.',
  requiredScopes: readScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getSheetNames: CapabilityResource = {
  kind: 'resource',
  name: 'get_sheet_names',
  uriTemplate: 'googlesheets://spreadsheets/{spreadsheetId}/sheets',
  description: 'Read the sheet-title-to-sheetId index for a single spreadsheet.',
  requiredScopes: readScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const valuesGet: CapabilityResource = {
  kind: 'resource',
  name: 'values_get',
  uriTemplate: 'googlesheets://spreadsheets/{spreadsheetId}/values/{range}',
  description: 'Read a single cell value range (A1 notation) from a spreadsheet.',
  requiredScopes: readScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only — search/parameterized/multi-range reads)
// ---------------------------------------------------------------------------

const searchSpreadsheets: CapabilityTool = {
  kind: 'tool',
  name: 'search_spreadsheets',
  description: 'Search Drive for spreadsheet files by query string, with spreadsheet-only filters.',
  requiredScopes: readScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      maxResults: { type: 'number' },
    },
    required: ['query'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const batchGet: CapabilityTool = {
  kind: 'tool',
  name: 'batch_get',
  description: 'Read multiple spreadsheet value ranges in a single parameterized call.',
  requiredScopes: readScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string' },
      ranges: { type: 'array', items: { type: 'string' } },
    },
    required: ['spreadsheetId', 'ranges'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getConditionalFormatRules: CapabilityTool = {
  kind: 'tool',
  name: 'get_conditional_format_rules',
  description: 'Read conditional formatting rules for a spreadsheet, grouped per sheet.',
  requiredScopes: readScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string' },
      sheetId: { type: 'number' },
      sheetTitle: { type: 'string' },
    },
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

const getDataValidationRules: CapabilityTool = {
  kind: 'tool',
  name: 'get_data_validation_rules',
  description: 'Read data validation rules for a spreadsheet, optionally scoped to a range.',
  requiredScopes: readScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string' },
      range: { type: 'string' },
      includeEmpty: { type: 'boolean' },
    },
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

const searchDeveloperMetadata: CapabilityTool = {
  kind: 'tool',
  name: 'search_developer_metadata',
  description: "Search a spreadsheet's developer metadata entries using data filters.",
  requiredScopes: readScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string' },
      dataFilters: { type: 'array', items: { type: 'object' } },
    },
    required: ['spreadsheetId', 'dataFilters'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const googlesheetsManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'googlesheets',
  version: '0.0.0',
  displayName: 'Google Sheets (BR-72 read-only benchmark proof)',
  resources: [getSpreadsheetInfo, getSheetNames, valuesGet],
  tools: [searchSpreadsheets, batchGet, getConditionalFormatRules, getDataValidationRules, searchDeveloperMetadata],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: readScopes,
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'googlesheetsAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'manual',
      description:
        'Google OAuth2 access token (spreadsheets.readonly + drive.readonly) — state-only visibility, value never disclosed.',
    },
  ],
};
