/**
 * BR-72 Wave-2 Lot 1 — GitHub EXPERIMENTAL write-capability manifest.
 *
 * MUTATION ONLY. Declares the 7 write tools this connector's Wave-2 write
 * surface exercises (subset of WAVE2_WRITE_PLAN.md §2.1's 66-row github
 * matrix, chosen as the write-surface pattern-establisher for Wave 2):
 * `create_repository`, `create_issue`, `update_issue`,
 * `create_or_update_file`, `delete_file`, `dispatch_workflow`,
 * `delete_repository`.
 *
 * This entry is deliberately SEPARATE from `./manifest.ts` (the read-only
 * Wave-1 manifest, frozen/unchanged) and is reachable ONLY via
 * `./experimental.ts` — never from the package root `./index.ts` — mirroring
 * `@sentropic/mcp-platform`'s own root/experimental split.
 *
 * Per WAVE2_WRITE_PLAN.md §2.1, every capability in this table declares
 * `mutatesExternalSystem: true`, `idempotency: { required: true, scope:
 * 'principal' }`, `gates.requiresPrincipalGate: true` and
 * `gates.requiresPolicy: true`. Destructive/irreversible tools
 * (`delete_file`, `delete_repository`) additionally set
 * `gates.requiresHumanConfirmation: true`.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// Every write tool shares the principal-gate + policy baseline (WAVE2_WRITE_PLAN.md
// §2.1 intro); only destructive/irreversible tools add human confirmation.
function writeGates(destructive: boolean): CapabilityGates {
  return {
    requiresElicitation: false,
    requiresHumanConfirmation: destructive,
    requiresPrincipalGate: true,
    requiresPolicy: true,
  };
}

const writeIdempotency = { required: true as const, scope: 'principal' as const };

// ---------------------------------------------------------------------------
// Write tools (WAVE2_WRITE_PLAN.md §2.1 subset)
// ---------------------------------------------------------------------------

const createRepository: CapabilityTool = {
  kind: 'tool',
  name: 'create_repository',
  description: 'Create a new GitHub repository owned by the authenticated principal.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      private: { type: 'boolean' },
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

const createIssue: CapabilityTool = {
  kind: 'tool',
  name: 'create_issue',
  description: 'Create a new issue in a repository.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['owner', 'repo', 'title'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const updateIssue: CapabilityTool = {
  kind: 'tool',
  name: 'update_issue',
  description: 'Patch an existing issue (title, body, state, assignees, labels).',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      issue_number: { type: 'number' },
      title: { type: 'string' },
      body: { type: 'string' },
      state: { type: 'string', enum: ['open', 'closed'] },
    },
    required: ['owner', 'repo', 'issue_number'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'patch',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

/**
 * UPSERT / COMPOSITE GAP (WAVE2_WRITE_PLAN.md §3 Lot 1 point 5): OOMOL treats
 * `create_or_update_file` as ONE composite action, but the Sentropic contract's
 * `Mutability` (`../../mcp-platform/src/manifest.ts`) is a CLOSED enum with no
 * composite member — 'append' (create) and 'patch' (update) are distinct
 * possible outcomes of the SAME capability, decided at call time by whether the
 * target path already exists. This connector resolves the gap by mapping the
 * capability to `mutability: 'state-transition'` — the classification
 * WAVE2_WRITE_PLAN.md §2.1 itself uses for this row — and documenting the
 * create/update ambiguity here explicitly rather than silently collapsing it
 * into 'append' or 'patch'. A future connector iteration MAY instead split
 * this into two capabilities (`create_file` / `update_file`) once a
 * composite-mutation descriptor is added to the frozen contract; that split is
 * NOT done here to stay within this lot's declared write-tool list.
 */
const createOrUpdateFile: CapabilityTool = {
  kind: 'tool',
  name: 'create_or_update_file',
  description:
    'Create a file at a path if it is absent, or update it if present (upsert). ' +
    'GAP: mapped to mutability "state-transition" — see the composite-gap comment above this declaration.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      path: { type: 'string' },
      content: { type: 'string', description: 'base64-encoded file content' },
      message: { type: 'string' },
      sha: { type: 'string', description: 'required when updating an existing file' },
    },
    required: ['owner', 'repo', 'path', 'content', 'message'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'state-transition',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const deleteFile: CapabilityTool = {
  kind: 'tool',
  name: 'delete_file',
  description: 'Delete a file at a path in a repository. Destructive, irreversible.',
  requiredScopes: ['repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      path: { type: 'string' },
      message: { type: 'string' },
      sha: { type: 'string' },
    },
    required: ['owner', 'repo', 'path', 'message', 'sha'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'delete',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

const dispatchWorkflow: CapabilityTool = {
  kind: 'tool',
  name: 'dispatch_workflow',
  description: 'Trigger a GitHub Actions workflow_dispatch run on a ref.',
  requiredScopes: ['workflow'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      workflow_id: { type: 'string' },
      ref: { type: 'string' },
      inputs: { type: 'object' },
    },
    required: ['owner', 'repo', 'workflow_id', 'ref'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'state-transition',
  category: 'workflow',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const deleteRepository: CapabilityTool = {
  kind: 'tool',
  name: 'delete_repository',
  description: 'Permanently delete a repository. Destructive, irreversible.',
  requiredScopes: ['delete_repo'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
    },
    required: ['owner', 'repo'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'delete',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

export const githubWriteManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'github',
  version: '0.0.0',
  displayName: 'GitHub (BR-72 Wave-2 EXPERIMENTAL write surface)',
  resources: [],
  tools: [
    createRepository,
    createIssue,
    updateIssue,
    createOrUpdateFile,
    deleteFile,
    dispatchWorkflow,
    deleteRepository,
  ],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['repo', 'workflow', 'delete_repo'],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['tool.invoke', 'tool.invoke.denied'],
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

export const githubWriteToolsByName: ReadonlyMap<string, CapabilityTool> = new Map(
  githubWriteManifest.tools.map((tool) => [tool.name, tool]),
);
