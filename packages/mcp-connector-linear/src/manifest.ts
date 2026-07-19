/**
 * BR-72 benchmark proof — Linear connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
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
// Resources (BR-72 matrix §7 linear rows)
// ---------------------------------------------------------------------------

const getCurrentUser: CapabilityResource = {
  kind: 'resource',
  name: 'get_current_user',
  uriTemplate: 'linear://user',
  description: 'Read the authenticated Linear user (viewer) profile.',
  requiredScopes: ['read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getLinearIssue: CapabilityResource = {
  kind: 'resource',
  name: 'get_linear_issue',
  uriTemplate: 'linear://issues/{issueId}',
  description:
    'Read a single Linear issue by ID, including comments, attachments, and relationship fields.',
  requiredScopes: ['read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getLinearProject: CapabilityResource = {
  kind: 'resource',
  name: 'get_linear_project',
  uriTemplate: 'linear://projects/{projectId}',
  description: 'Read a single Linear project by ID, with its teams, members, and initiatives.',
  requiredScopes: ['read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getAttachment: CapabilityResource = {
  kind: 'resource',
  name: 'get_attachment',
  uriTemplate: 'linear://issues/{issueId}/attachments/{attachmentId}',
  description: 'Read a single Linear attachment on an issue by ID.',
  requiredScopes: ['read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only)
// ---------------------------------------------------------------------------

const listLinearIssues: CapabilityTool = {
  kind: 'tool',
  name: 'list_linear_issues',
  description:
    'List Linear issues accessible with current credentials, optionally filtered by project or assignee.',
  requiredScopes: ['read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      assignee_id: { type: 'string' },
      after: { type: 'string' },
      first: { type: 'number' },
    },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listLinearTeams: CapabilityTool = {
  kind: 'tool',
  name: 'list_linear_teams',
  description:
    'List Linear teams accessible with current credentials, along with their members and projects.',
  requiredScopes: ['read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { project_id: { type: 'string' } },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const searchIssues: CapabilityTool = {
  kind: 'tool',
  name: 'search_issues',
  description: "Retrieve issues through Linear's full-text search capabilities.",
  requiredScopes: ['read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      after: { type: 'string' },
      first: { type: 'number' },
      include_archived: { type: 'boolean' },
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

export const linearManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'linear',
  version: '0.0.0',
  displayName: 'Linear (BR-72 read-only benchmark proof)',
  resources: [getCurrentUser, getLinearIssue, getLinearProject, getAttachment],
  tools: [listLinearIssues, listLinearTeams, searchIssues],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['read'],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'linearOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'Linear OAuth2 access token — state-only visibility, value never disclosed.',
    },
    {
      name: 'linearApiKey',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'Linear personal API key — state-only visibility, value never disclosed.',
    },
  ],
};
