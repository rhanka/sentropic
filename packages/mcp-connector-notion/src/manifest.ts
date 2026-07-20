/**
 * BR-72 Wave-1 benchmark proof — Notion connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding: taxonomy-only read from the OOMOL open-connector
 * `notion` provider (`actions.ts` read/list/get/search/retrieve/query
 * leading-verb actions + `definition.ts` authTypes). No OOMOL code copied —
 * every capability below is recoded independently against the Sentropic
 * schema shapes.
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

// OOMOL `notionReadScopes` (scopes.ts) — the single read capability scope
// shared by every read action in the OOMOL notion provider.
const notionReadScopes = ['read_content'];

// ---------------------------------------------------------------------------
// Resources — URI-addressable single-entity reads (BR-72 matrix §7 notion rows)
// ---------------------------------------------------------------------------

const retrievePage: CapabilityResource = {
  kind: 'resource',
  name: 'retrieve_page',
  uriTemplate: 'notion://pages/{pageId}',
  description: "Read a single Notion page's properties and metadata by page ID.",
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const retrieveDatabase: CapabilityResource = {
  kind: 'resource',
  name: 'retrieve_database',
  uriTemplate: 'notion://databases/{databaseId}',
  description: "Read a single Notion database container's metadata and schema by database ID.",
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const retrieveDataSource: CapabilityResource = {
  kind: 'resource',
  name: 'retrieve_data_source',
  uriTemplate: 'notion://data-sources/{dataSourceId}',
  description: 'Read a single Notion data source by data source ID.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const retrieveUser: CapabilityResource = {
  kind: 'resource',
  name: 'retrieve_user',
  uriTemplate: 'notion://users/{userId}',
  description: 'Read a single Notion workspace user by user ID.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  outputSchema: { type: 'object' },
  // Person users carry an email address (§7.1 discovery visibility is unaffected;
  // this only raises the per-capability redaction classification above 'low').
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only) — parameterized/paginated reads
// ---------------------------------------------------------------------------

const search: CapabilityTool = {
  kind: 'tool',
  name: 'search',
  description: 'Search Notion pages and data sources by query text.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const queryDataSource: CapabilityTool = {
  kind: 'tool',
  name: 'query_data_source',
  description: 'Query a Notion data source with filters, sorts and pagination.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      dataSourceId: { type: 'string' },
      pageSize: { type: 'number' },
      startCursor: { type: 'string' },
    },
    required: ['dataSourceId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listUsers: CapabilityTool = {
  kind: 'tool',
  name: 'list_users',
  description: 'List users in the Notion workspace with pagination.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      pageSize: { type: 'number' },
      startCursor: { type: 'string' },
    },
    required: [],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listBlockChildren: CapabilityTool = {
  kind: 'tool',
  name: 'list_block_children',
  description: 'List the direct child blocks under a Notion block with pagination.',
  requiredScopes: notionReadScopes,
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      blockId: { type: 'string' },
      pageSize: { type: 'number' },
      startCursor: { type: 'string' },
    },
    required: ['blockId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const notionManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'notion',
  version: '0.0.0',
  displayName: 'Notion (BR-72 read-only benchmark proof)',
  resources: [retrievePage, retrieveDatabase, retrieveDataSource, retrieveUser],
  tools: [search, queryDataSource, listUsers, listBlockChildren],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: notionReadScopes,
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'moderate',
  },
  durability: {},
  secrets: [
    // OOMOL authTypes: 'oauth2' -> principal-scoped secret (per-user delegated token).
    {
      name: 'notionOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'manual',
      description: 'Notion OAuth access token — state-only visibility, value never disclosed.',
    },
    // OOMOL authTypes: 'api_key' -> connector-instance-scoped secret (internal
    // integration secret shared with target pages/databases, not tied to a principal).
    {
      name: 'notionIntegrationSecret',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description:
        'Notion internal integration secret (API key) — state-only visibility, value never disclosed.',
    },
  ],
};
