/**
 * BR-72 Wave-1 benchmark proof — Slack connector manifest.
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
// Resources (BR-72 matrix §7 slack rows) — URI-addressable single-entity reads
// ---------------------------------------------------------------------------

const getConversation: CapabilityResource = {
  kind: 'resource',
  name: 'get_conversation',
  uriTemplate: 'slack://conversations/{channelId}',
  description: 'Read metadata for a single Slack conversation (channel, group, or DM) by ID.',
  requiredScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getUser: CapabilityResource = {
  kind: 'resource',
  name: 'get_user',
  uriTemplate: 'slack://users/{userId}',
  description: 'Read profile metadata for a single Slack user by ID.',
  requiredScopes: ['users:read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getFile: CapabilityResource = {
  kind: 'resource',
  name: 'get_file',
  uriTemplate: 'slack://files/{fileId}',
  description: 'Read metadata for a single Slack file by ID.',
  requiredScopes: ['files:read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only) — lists, searches and parameterized reads
// ---------------------------------------------------------------------------

const listChannels: CapabilityTool = {
  kind: 'tool',
  name: 'list_channels',
  description: 'List Slack public channels visible to the connector.',
  requiredScopes: ['channels:read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number' } },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listConversations: CapabilityTool = {
  kind: 'tool',
  name: 'list_conversations',
  description: 'List Slack conversations (channels, groups, DMs) visible to the connector.',
  requiredScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      cursor: { type: 'string' },
      types: { type: 'array', items: { type: 'string' } },
    },
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
  description: 'List Slack users visible to the connector.',
  requiredScopes: ['users:read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number' }, cursor: { type: 'string' } },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getChannelMessages: CapabilityTool = {
  kind: 'tool',
  name: 'get_channel_messages',
  description: 'Get recent messages from a Slack conversation.',
  requiredScopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { channelId: { type: 'string' }, limit: { type: 'number' } },
    required: ['channelId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getThread: CapabilityTool = {
  kind: 'tool',
  name: 'get_thread',
  description: 'Get messages in a Slack thread.',
  requiredScopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { channelId: { type: 'string' }, threadTs: { type: 'string' } },
    required: ['channelId', 'threadTs'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const slackManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'slack',
  version: '0.0.0',
  displayName: 'Slack (BR-72 read-only benchmark proof)',
  resources: [getConversation, getUser, getFile],
  tools: [listChannels, listConversations, listUsers, getChannelMessages, getThread],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [
      'channels:read',
      'groups:read',
      'im:read',
      'mpim:read',
      'channels:history',
      'groups:history',
      'im:history',
      'mpim:history',
      'users:read',
      'files:read',
    ],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'moderate',
  },
  durability: {},
  secrets: [
    {
      name: 'slackAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'manual',
      description: 'Slack OAuth2 access token — state-only visibility, value never disclosed.',
    },
  ],
};
