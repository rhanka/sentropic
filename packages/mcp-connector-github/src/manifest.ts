/**
 * BR-72 Wave-1 benchmark proof — GitHub connector manifest.
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
// Resources (BR-72 matrix §7 github rows)
// ---------------------------------------------------------------------------

const getCurrentUser: CapabilityResource = {
  kind: 'resource',
  name: 'get_current_user',
  uriTemplate: 'github://user',
  description: 'Read the authenticated GitHub user profile.',
  requiredScopes: ['read:user', 'user:email'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listMyRepositories: CapabilityResource = {
  kind: 'resource',
  name: 'list_my_repositories',
  uriTemplate: 'github://user/repos',
  description: 'List repositories owned by (or accessible to) the authenticated user.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  outputSchema: { type: 'array' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getRepository: CapabilityResource = {
  kind: 'resource',
  name: 'get_repository',
  uriTemplate: 'github://repos/{owner}/{repo}',
  description: 'Read a single repository record by owner/name.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getFileContents: CapabilityResource = {
  kind: 'resource',
  name: 'get_file_contents',
  uriTemplate: 'github://repos/{owner}/{repo}/contents/{path}',
  description: 'Read a file (or directory listing) at a given path in a repository.',
  requiredScopes: ['repo'],
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

const searchRepositories: CapabilityTool = {
  kind: 'tool',
  name: 'search_repositories',
  description: 'Search public GitHub repositories by query string.',
  requiredScopes: [],
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

const checkPullRequestMerged: CapabilityTool = {
  kind: 'tool',
  name: 'check_pull_request_merged',
  description: 'Check whether a pull request has been merged.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      pull_number: { type: 'number' },
    },
    required: ['owner', 'repo', 'pull_number'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const compareCommits: CapabilityTool = {
  kind: 'tool',
  name: 'compare_commits',
  description: 'Compare two commits/branches/tags in a repository.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
    },
    required: ['owner', 'repo', 'base', 'head'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const githubManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'github',
  version: '0.0.0',
  displayName: 'GitHub (BR-72 read-only benchmark proof)',
  resources: [getCurrentUser, listMyRepositories, getRepository, getFileContents],
  tools: [searchRepositories, checkPullRequestMerged, compareCommits],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['read:user', 'user:email', 'repo'],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'githubAccessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'GitHub personal/OAuth access token — state-only visibility, value never disclosed.',
    },
  ],
};
