/**
 * BR-72 Wave-1 benchmark proof — Dropbox connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding (taxonomy-only, independently recoded — no OOMOL code
 * vendored): OOMOL `src/providers/dropbox/actions.ts` declares 24 actions
 * across 4 read scopes (`account_info.read`, `files.metadata.read`,
 * `files.content.read`, `sharing.read`) and 2 write scopes
 * (`files.content.write`, `sharing.write`). The 8 capabilities below are the
 * representative read-only subset (leading verb get/list/search, read scope
 * only): one per read scope pairing of single-entity read (resource) vs.
 * list/search/parameterized read (tool).
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

// ---------------------------------------------------------------------------
// Resources (BR-72 matrix §7 dropbox rows) — URI-addressable single-entity
// reads.
// ---------------------------------------------------------------------------

const getCurrentAccount: CapabilityResource = {
  kind: 'resource',
  name: 'get_current_account',
  uriTemplate: 'dropbox://account',
  description: 'Read basic profile information for the current Dropbox account.',
  requiredScopes: ['account_info.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getMetadata: CapabilityResource = {
  kind: 'resource',
  name: 'get_metadata',
  uriTemplate: 'dropbox://files/{path}',
  description: 'Read Dropbox metadata for a single file or folder by path.',
  requiredScopes: ['files.metadata.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const downloadFile: CapabilityResource = {
  kind: 'resource',
  name: 'download_file',
  uriTemplate: 'dropbox://files/{path}/content',
  description: 'Read (download) the content of a single Dropbox file by path, returned as base64.',
  requiredScopes: ['files.content.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getSharedLinkMetadata: CapabilityResource = {
  kind: 'resource',
  name: 'get_shared_link_metadata',
  uriTemplate: 'dropbox://shared-links/{url}',
  description: 'Read metadata for a single Dropbox shared link.',
  requiredScopes: ['sharing.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only) — list/search/parameterized reads.
// ---------------------------------------------------------------------------

const listFolder: CapabilityTool = {
  kind: 'tool',
  name: 'list_folder',
  description: 'List files and folders inside a Dropbox folder.',
  requiredScopes: ['files.metadata.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: [],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const searchFiles: CapabilityTool = {
  kind: 'tool',
  name: 'search_files',
  description: 'Search Dropbox files and folders by query string.',
  requiredScopes: ['files.metadata.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
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

const listSharedLinks: CapabilityTool = {
  kind: 'tool',
  name: 'list_shared_links',
  description: 'List Dropbox shared links for the current user or a specific path.',
  requiredScopes: ['sharing.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: [],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listRevisions: CapabilityTool = {
  kind: 'tool',
  name: 'list_revisions',
  description: 'List revisions for a single Dropbox file.',
  requiredScopes: ['files.metadata.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const dropboxManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'dropbox',
  version: '0.0.0',
  displayName: 'Dropbox (BR-72 read-only benchmark proof)',
  resources: [getCurrentAccount, getMetadata, downloadFile, getSharedLinkMetadata],
  tools: [listFolder, searchFiles, listSharedLinks, listRevisions],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['account_info.read', 'files.metadata.read', 'files.content.read', 'sharing.read'],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'dropboxOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description:
        'Dropbox OAuth2 access token (authTypes: oauth2 in the OOMOL source) — principal-scoped, state-only visibility, value never disclosed.',
    },
  ],
};
