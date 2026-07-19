/**
 * BR-72 Wave-1 — Gmail READ-ONLY connector manifest (benchmark proof).
 *
 * Declares the four read-only capabilities from the BR-72 matrix §7 gmail rows
 * (all oauth2): `search_threads` (tool, discover), `get_message` (resource),
 * `list_drafts` (resource, discover), `get_draft` (resource). Every capability
 * here is CLOSED read-only per SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §4.3:
 * `mutability: 'read-only'` / `mutatesExternalSystem: false` /
 * `idempotency: { required: false }` are declared explicitly, never implicit.
 *
 * This is a Sentropic-owned, independently recoded manifest against the local
 * `@sentropic/mcp-platform` contracts — types only, no OOMOL code vendored.
 */
import type {
  AppMcpProviderManifest,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

const readOnlyGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

export const searchThreads: CapabilityTool = {
  kind: 'tool',
  name: 'search_threads',
  description: 'Discover Gmail threads matching a search query (read-only, non-mutating).',
  requiredScopes: ['gmail.readonly'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, maxResults: { type: 'number' } },
    required: ['query'],
  },
  outputSchema: { type: 'array' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const getMessage: CapabilityResource = {
  kind: 'resource',
  name: 'get_message',
  uriTemplate: 'gmail://messages/{messageId}',
  description: 'Read a single Gmail message by id.',
  requiredScopes: ['gmail.readonly'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const listDrafts: CapabilityResource = {
  kind: 'resource',
  name: 'list_drafts',
  uriTemplate: 'gmail://drafts',
  description: 'Discover the collection of Gmail drafts.',
  requiredScopes: ['gmail.compose'],
  requiredClaims: [],
  outputSchema: { type: 'array' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const getDraft: CapabilityResource = {
  kind: 'resource',
  name: 'get_draft',
  uriTemplate: 'gmail://drafts/{draftId}',
  description: 'Read a single Gmail draft by id.',
  requiredScopes: ['gmail.compose'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const gmailManifest: AppMcpProviderManifest = {
  appId: 'gmail',
  providerId: 'gmail-connector',
  version: '0.0.0',
  displayName: 'Gmail (BR-72 Wave-1 read-only proof)',
  resources: [getMessage, listDrafts, getDraft],
  tools: [searchThreads],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['gmail.readonly', 'gmail.compose'],
    tenantResolution: 'connector-instance',
    freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  },
  audit: { eventKinds: ['tool.invoke', 'resource.read'], piiClass: 'moderate' },
  durability: {},
  secrets: [
    {
      name: 'gmailOAuthAccessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'OAuth2 access token for the connected Gmail account (gmail.readonly + gmail.compose scopes).',
    },
  ],
};
