/**
 * BR-72 Wave-2 Lot 2 — Google Drive EXPERIMENTAL write-capability manifest.
 *
 * MUTATION ONLY. Declares the 6 write tools this connector's Wave-2 write
 * surface exercises (subset of WAVE2_WRITE_PLAN.md §2.2's 23-row googledrive
 * matrix, chosen as the write-surface pattern-establisher for Wave 2, mirroring
 * the github-write Lot 1 pattern): `files.create`, `files.update`,
 * `files.copy`, `permissions.create`, `files.delete`, `drives.create`.
 *
 * This entry is deliberately SEPARATE from `./manifest.ts` (the read-only
 * Wave-1 manifest, frozen/unchanged) and is reachable ONLY via
 * `./experimental.ts` — never from the package root `./index.ts` — mirroring
 * `@sentropic/mcp-platform`'s own root/experimental split.
 *
 * Per WAVE2_WRITE_PLAN.md §2.2, every capability in this table declares
 * `mutatesExternalSystem: true`, `idempotency: { required: true, scope:
 * 'principal' }`, `gates.requiresPrincipalGate: true` and
 * `gates.requiresPolicy: true`. `files.delete` (destructive/irreversible) and
 * `permissions.create` (irreversible, security-sensitive: grants external
 * access/sharing) additionally set `gates.requiresHumanConfirmation: true`.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// Every write tool shares the principal-gate + policy baseline (WAVE2_WRITE_PLAN.md
// §2.2 intro); only destructive/irreversible or authz-state-changing tools add
// human confirmation.
function writeGates(requiresHumanConfirmation: boolean): CapabilityGates {
  return {
    requiresElicitation: false,
    requiresHumanConfirmation,
    requiresPrincipalGate: true,
    requiresPolicy: true,
  };
}

const writeIdempotency = { required: true as const, scope: 'principal' as const };

// ---------------------------------------------------------------------------
// Write tools (WAVE2_WRITE_PLAN.md §2.2 subset)
// ---------------------------------------------------------------------------

const filesCreate: CapabilityTool = {
  kind: 'tool',
  name: 'files.create',
  description: 'Create a new file (metadata + optional content) in the authenticated principal\'s Google Drive.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      mimeType: { type: 'string' },
      parents: { type: 'array', items: { type: 'string' } },
      content: { type: 'string', description: 'base64-encoded file content' },
    },
    required: ['name'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const filesUpdate: CapabilityTool = {
  kind: 'tool',
  name: 'files.update',
  description: 'Patch an existing file\'s metadata and/or content.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
      name: { type: 'string' },
      addParents: { type: 'array', items: { type: 'string' } },
      removeParents: { type: 'array', items: { type: 'string' } },
      content: { type: 'string', description: 'base64-encoded file content' },
    },
    required: ['fileId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'patch',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const filesCopy: CapabilityTool = {
  kind: 'tool',
  name: 'files.copy',
  description: 'Create a copy of an existing file, optionally with a new name/parent.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
      name: { type: 'string' },
      parents: { type: 'array', items: { type: 'string' } },
    },
    required: ['fileId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

/**
 * IRREVERSIBLE AUTHZ-STATE GAP (WAVE2_WRITE_PLAN.md §2.2): granting a
 * permission is an authz state-transition on the target file/drive — it is
 * NOT a simple additive write, since it changes who can read/write external
 * resources. `requiresHumanConfirmation: true` here mirrors the plan's HC
 * gate for this capability (irreversible, security-sensitive sharing).
 */
const permissionsCreate: CapabilityTool = {
  kind: 'tool',
  name: 'permissions.create',
  description:
    'Grant a permission (role + grantee) on a Drive file or shared drive. Irreversible ' +
    'authz state-transition — see the comment above this declaration.',
  requiredScopes: ['https://www.googleapis.com/auth/drive'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
      role: { type: 'string', enum: ['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'] },
      type: { type: 'string', enum: ['user', 'group', 'domain', 'anyone'] },
      emailAddress: { type: 'string' },
    },
    required: ['fileId', 'role', 'type'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'state-transition',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

const filesDelete: CapabilityTool = {
  kind: 'tool',
  name: 'files.delete',
  description: 'Permanently delete a file (bypassing trash). Destructive, irreversible.',
  requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
    },
    required: ['fileId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'delete',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

const drivesCreate: CapabilityTool = {
  kind: 'tool',
  name: 'drives.create',
  description: 'Create a new shared drive owned by the authenticated principal.',
  requiredScopes: ['https://www.googleapis.com/auth/drive'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      requestId: { type: 'string', description: 'client-generated idempotency token for drive creation' },
    },
    required: ['name', 'requestId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

export const googleDriveWriteManifest: AppMcpProviderManifest = {
  appId: 'sentropic-googledrive',
  providerId: 'googledrive',
  version: '0.0.0',
  displayName: 'Google Drive (BR-72 Wave-2 EXPERIMENTAL write surface)',
  resources: [],
  tools: [
    filesCreate,
    filesUpdate,
    filesCopy,
    permissionsCreate,
    filesDelete,
    drivesCreate,
  ],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['tool.invoke', 'tool.invoke.denied'],
    piiClass: 'low',
  },
  durability: {},
  secrets: [
    {
      name: 'accessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'Google OAuth2 Access Token — state-only visibility, value never disclosed.',
    },
  ],
};

export const googleDriveWriteToolsByName: ReadonlyMap<string, CapabilityTool> = new Map(
  googleDriveWriteManifest.tools.map((tool) => [tool.name, tool]),
);
