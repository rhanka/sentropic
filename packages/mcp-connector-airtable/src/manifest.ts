/**
 * BR-72 Wave-1 benchmark proof — Airtable connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding: the OOMOL `open-connector` airtable provider
 * (`src/providers/airtable/actions.ts` + `definition.ts`) exposes 14 actions
 * total; exactly 5 carry a read-leading verb (get/list) — `list_bases`,
 * `get_base_collaborators`, `get_base_schema`, `list_records`, `get_record`.
 * All 5 are recoded independently below; the remaining 9 (create/update/
 * delete) are mutation-only and out of scope for this read-only proof.
 *
 * Scope fidelity note: OOMOL's airtable action mapping hard-codes
 * `requiredScopes: []` for every action (personal-access-token auth model;
 * Airtable's real PAT scopes such as `data.records:read` are not encoded in
 * the OOMOL taxonomy) — recoded faithfully as `[]` per capability below, not
 * silently omitted or invented.
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
// Resources (BR-72 matrix §7 airtable rows)
// ---------------------------------------------------------------------------

const listBases: CapabilityResource = {
  kind: 'resource',
  name: 'list_bases',
  uriTemplate: 'airtable://bases',
  description: 'List Airtable bases accessible to the authenticated personal access token.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getBaseCollaborators: CapabilityResource = {
  kind: 'resource',
  name: 'get_base_collaborators',
  uriTemplate: 'airtable://bases/{baseId}',
  description: 'Read Airtable base metadata, including workspace ID and optional collaborator details.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getBaseSchema: CapabilityResource = {
  kind: 'resource',
  name: 'get_base_schema',
  uriTemplate: 'airtable://bases/{baseId}/tables',
  description: 'Read the table, field, and view schema for a specific Airtable base.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getRecord: CapabilityResource = {
  kind: 'resource',
  name: 'get_record',
  uriTemplate: 'airtable://bases/{baseId}/tables/{tableIdOrName}/records/{recordId}',
  description: 'Read a single Airtable record by record ID.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only)
// ---------------------------------------------------------------------------

const listRecords: CapabilityTool = {
  kind: 'tool',
  name: 'list_records',
  description:
    'List Airtable records from a table with optional view, formula filter, sort, and pagination parameters.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      baseId: { type: 'string' },
      tableIdOrName: { type: 'string' },
      view: { type: 'string' },
      filterByFormula: { type: 'string' },
      pageSize: { type: 'number' },
      offset: { type: 'string' },
    },
    required: ['baseId', 'tableIdOrName'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const airtableManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'airtable',
  version: '0.0.0',
  displayName: 'Airtable (BR-72 read-only benchmark proof)',
  resources: [listBases, getBaseCollaborators, getBaseSchema, getRecord],
  tools: [listRecords],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [],
    tenantResolution: 'connector-instance',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'moderate',
  },
  durability: {},
  secrets: [
    {
      name: 'airtablePersonalAccessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'Airtable personal access token — state-only visibility, value never disclosed.',
    },
  ],
};
