/**
 * BR-72 Wave-2 Lot 3 — Gmail EXPERIMENTAL write-capability manifest.
 *
 * MUTATION ONLY. Declares the 8 write tools this connector's Wave-2 write
 * surface exercises: send_email, create_draft, update_draft, delete_draft,
 * create_label, add_label_to_email, move_to_trash, create_filter.
 *
 * This entry is deliberately SEPARATE from `./manifest.ts` (the read-only
 * Wave-1 manifest, frozen/unchanged) and is reachable ONLY via
 * `./experimental.ts` — never from the package root `./index.ts` — mirroring
 * `@sentropic/mcp-platform`'s own root/experimental split.
 *
 * Per WAVE2_WRITE_PLAN.md §2.3, every capability in this table declares
 * `mutatesExternalSystem: true`, `idempotency: { required: true, scope:
 * 'principal' }`, `gates.requiresPrincipalGate: true` and
 * `gates.requiresPolicy: true`. Destructive/irreversible tools
 * (`send_email`, `delete_draft`) additionally set
 * `gates.requiresHumanConfirmation: true`.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// Every write tool shares the principal-gate + policy baseline (WAVE2_WRITE_PLAN.md
// §2.3 intro); only destructive/irreversible/external tools add human confirmation.
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
// Gmail Write tools (WAVE2_WRITE_PLAN.md §2.3 subset)
// ---------------------------------------------------------------------------

const sendEmail: CapabilityTool = {
  kind: 'tool',
  name: 'send_email',
  description: 'Send an email message to external recipients. Destructive/irreversible.',
  requiredScopes: ['gmail.send'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'append',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

const createDraft: CapabilityTool = {
  kind: 'tool',
  name: 'create_draft',
  description: 'Create a new draft email.',
  requiredScopes: ['gmail.compose'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const updateDraft: CapabilityTool = {
  kind: 'tool',
  name: 'update_draft',
  description: 'Update the content of an existing draft email.',
  requiredScopes: ['gmail.compose'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      draftId: { type: 'string' },
      to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['draftId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'patch',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const deleteDraft: CapabilityTool = {
  kind: 'tool',
  name: 'delete_draft',
  description: 'Delete a draft email by id. Destructive/irreversible.',
  requiredScopes: ['gmail.compose'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      draftId: { type: 'string' },
    },
    required: ['draftId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'delete',
  category: 'transaction',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(true),
};

const createLabel: CapabilityTool = {
  kind: 'tool',
  name: 'create_label',
  description: 'Create a new Gmail label.',
  requiredScopes: ['gmail.labels'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
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

const addLabelToEmail: CapabilityTool = {
  kind: 'tool',
  name: 'add_label_to_email',
  description: 'Apply a label to a specific email message.',
  requiredScopes: ['gmail.modify'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
      labelId: { type: 'string' },
    },
    required: ['messageId', 'labelId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'patch',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const moveToTrash: CapabilityTool = {
  kind: 'tool',
  name: 'move_to_trash',
  description: 'Move an email message or thread to trash (state transition).',
  requiredScopes: ['gmail.modify'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
    },
    required: ['messageId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'state-transition',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

const createFilter: CapabilityTool = {
  kind: 'tool',
  name: 'create_filter',
  description: 'Create a new email filter with criteria and matching action.',
  requiredScopes: ['gmail.settings.basic'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      criteria: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          subject: { type: 'string' },
          query: { type: 'string' },
        },
      },
      action: {
        type: 'object',
        properties: {
          addLabelIds: { type: 'array', items: { type: 'string' } },
          removeLabelIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['criteria', 'action'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'append',
  category: 'write',
  mutatesExternalSystem: true,
  idempotency: writeIdempotency,
  gates: writeGates(false),
};

export const gmailWriteManifest: AppMcpProviderManifest = {
  appId: 'gmail',
  providerId: 'gmail-connector',
  version: '0.0.0',
  displayName: 'Gmail (BR-72 Wave-2 EXPERIMENTAL write surface)',
  resources: [],
  tools: [
    sendEmail,
    createDraft,
    updateDraft,
    deleteDraft,
    createLabel,
    addLabelToEmail,
    moveToTrash,
    createFilter,
  ],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [
      'gmail.readonly',
      'gmail.compose',
      'gmail.send',
      'gmail.modify',
      'gmail.labels',
      'gmail.settings.basic',
    ],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['tool.invoke', 'tool.invoke.denied'],
    piiClass: 'moderate',
  },
  durability: {},
  secrets: [
    {
      name: 'gmailOAuthAccessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'OAuth2 access token for the connected Gmail account.',
    },
  ],
};

export const gmailWriteToolsByName: ReadonlyMap<string, CapabilityTool> = new Map(
  gmailWriteManifest.tools.map((tool) => [tool.name, tool]),
);
