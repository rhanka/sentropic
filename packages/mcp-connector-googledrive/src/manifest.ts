import type {
  AppMcpProviderManifest,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

export const aboutGetCapability: CapabilityResource = {
  kind: 'resource',
  name: 'about.get',
  uriTemplate: 'googledrive://{tenantRef}/about',
  description: 'Get information about the user\'s Drive and system capabilities.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  outputSchema: {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          emailAddress: { type: 'string' },
        },
      },
      storageQuota: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
          usage: { type: 'string' },
        },
      },
    },
  },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const filesListCapability: CapabilityResource = {
  kind: 'resource',
  name: 'files.list',
  uriTemplate: 'googledrive://{tenantRef}/files',
  description: 'List or search files in the user\'s Google Drive.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  outputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            mimeType: { type: 'string' },
          },
        },
      },
    },
  },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const filesGetCapability: CapabilityResource = {
  kind: 'resource',
  name: 'files.get',
  uriTemplate: 'googledrive://{tenantRef}/files/{fileId}',
  description: 'Retrieve file metadata by its ID.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  outputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      mimeType: { type: 'string' },
      size: { type: 'string' },
    },
  },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const permissionsListCapability: CapabilityResource = {
  kind: 'resource',
  name: 'permissions.list',
  uriTemplate: 'googledrive://{tenantRef}/files/{fileId}/permissions',
  description: 'List permissions on a Google Drive file.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  outputSchema: {
    type: 'object',
    properties: {
      permissions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string' },
            type: { type: 'string' },
            emailAddress: { type: 'string' },
          },
        },
      },
    },
  },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const commentsGetCapability: CapabilityResource = {
  kind: 'resource',
  name: 'comments.get',
  uriTemplate: 'googledrive://{tenantRef}/files/{fileId}/comments',
  description: 'Retrieve comments for a specific file.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  outputSchema: {
    type: 'object',
    properties: {
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            author: {
              type: 'object',
              properties: {
                displayName: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const filesExportCapability: CapabilityTool = {
  kind: 'tool',
  name: 'files.export',
  description: 'Export a Google Doc/Sheet/Slides file using a parameterized format/MIME type.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The ID of the file to export.' },
      mimeType: { type: 'string', description: 'The target MIME type to export the file to.' },
    },
    required: ['fileId', 'mimeType'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The exported content (text/markdown/html).' },
      mimeType: { type: 'string', description: 'The actual MIME type of the exported content.' },
    },
  },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const googleDriveManifest: AppMcpProviderManifest = {
  appId: 'sentropic-googledrive',
  providerId: 'googledrive',
  version: '0.0.0',
  displayName: 'Google Drive Connector',
  resources: [
    aboutGetCapability,
    filesListCapability,
    filesGetCapability,
    permissionsListCapability,
    commentsGetCapability,
  ],
  tools: [
    filesExportCapability,
  ],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    tenantResolution: 'connector-instance',
    freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  },
  audit: {
    eventKinds: ['resource.read', 'tool.invoke', 'secret.access'],
    piiClass: 'low',
  },
  durability: {
    longRunningTools: [],
    workflowBackedTools: [],
  },
  secrets: [
    {
      name: 'accessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'Google OAuth2 Access Token',
    },
  ],
};
