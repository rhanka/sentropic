/**
 * Hermetic Google read-only adapter manifests. These are benchmark proofs for
 * the frozen MCP platform contract, not production OAuth or API clients.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
} from '@sentropic/mcp-platform';

const googleDriveReadScope = 'https://www.googleapis.com/auth/drive.readonly';
const gmailReadScope = 'https://www.googleapis.com/auth/gmail.readonly';

const readOnlyGates: CapabilityGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

const driveAboutGet: CapabilityResource = {
  kind: 'resource',
  name: 'about.get',
  uriTemplate: 'google-drive://about',
  description: 'Read the selected Google Drive account and storage metadata.',
  requiredScopes: [googleDriveReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const driveFilesGet: CapabilityResource = {
  kind: 'resource',
  name: 'files.get',
  uriTemplate: 'google-drive://files/{fileId}',
  description: 'Read Google Drive file metadata by file identifier.',
  requiredScopes: [googleDriveReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const driveFilesList: CapabilityTool = {
  kind: 'tool',
  name: 'files.list',
  description: 'List Google Drive files visible to the selected account.',
  requiredScopes: [googleDriveReadScope],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const driveFilesExport: CapabilityTool = {
  kind: 'tool',
  name: 'files.export',
  description: 'Read a Google Workspace file export in a requested MIME type.',
  requiredScopes: [googleDriveReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { fileId: { type: 'string' }, mimeType: { type: 'string' } },
    required: ['fileId', 'mimeType'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const drivePermissionsList: CapabilityTool = {
  kind: 'tool',
  name: 'permissions.list',
  description: 'List permissions for a Google Drive file.',
  requiredScopes: [googleDriveReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { fileId: { type: 'string' } },
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

const gmailMessagesGet: CapabilityResource = {
  kind: 'resource',
  name: 'messages.get',
  uriTemplate: 'gmail://messages/{messageId}',
  description: 'Read one Gmail message by identifier.',
  requiredScopes: [gmailReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const gmailThreadsGet: CapabilityResource = {
  kind: 'resource',
  name: 'threads.get',
  uriTemplate: 'gmail://threads/{threadId}',
  description: 'Read one Gmail conversation thread by identifier.',
  requiredScopes: [gmailReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const gmailMessagesList: CapabilityTool = {
  kind: 'tool',
  name: 'messages.list',
  description: 'List Gmail message references for a query.',
  requiredScopes: [gmailReadScope],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const gmailLabelsList: CapabilityTool = {
  kind: 'tool',
  name: 'labels.list',
  description: 'List labels configured for the selected Gmail account.',
  requiredScopes: [gmailReadScope],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const googleDriveManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'google-drive',
  version: '0.0.0',
  displayName: 'Google Drive (read-only adapter proof)',
  resources: [driveAboutGet, driveFilesGet],
  tools: [driveFilesList, driveFilesExport, drivePermissionsList],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [googleDriveReadScope],
    tenantResolution: 'connector-instance',
  },
  audit: { eventKinds: ['read', 'invoke'], piiClass: 'moderate' },
  durability: {},
  secrets: [
    {
      name: 'googleOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'Google OAuth access token; its value is never disclosed by this adapter.',
    },
  ],
};

export const gmailManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'gmail',
  version: '0.0.0',
  displayName: 'Gmail (read-only adapter proof)',
  resources: [gmailMessagesGet, gmailThreadsGet],
  tools: [gmailMessagesList, gmailLabelsList],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [gmailReadScope],
    tenantResolution: 'connector-instance',
  },
  audit: { eventKinds: ['read', 'invoke'], piiClass: 'moderate' },
  durability: {},
  secrets: [
    {
      name: 'googleOAuthAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'Google OAuth access token; its value is never disclosed by this adapter.',
    },
  ],
};
