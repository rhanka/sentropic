/**
 * BR-72 read-only benchmark proof — HubSpot connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no create/update/delete CRM action, no `manage_crm_objects`, no
 * `submit_feedback`). This is a recoded proof against the Sentropic
 * `@sentropic/mcp-platform` contract (see `../../mcp-platform/src/manifest.ts`),
 * not the production connector.
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
// Resources (single-entity, URI-addressable reads)
// ---------------------------------------------------------------------------

const getUserDetails: CapabilityResource = {
  kind: 'resource',
  name: 'get_user_details',
  uriTemplate: 'hubspot://user',
  description: "Read the authenticated HubSpot MCP user's account and access details.",
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getContact: CapabilityResource = {
  kind: 'resource',
  name: 'get_contact',
  uriTemplate: 'hubspot://contacts/{recordId}',
  description: 'Read a single HubSpot contact by record ID.',
  requiredScopes: ['hubspot.contacts.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getCompany: CapabilityResource = {
  kind: 'resource',
  name: 'get_company',
  uriTemplate: 'hubspot://companies/{recordId}',
  description: 'Read a single HubSpot company by record ID.',
  requiredScopes: ['hubspot.companies.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getDeal: CapabilityResource = {
  kind: 'resource',
  name: 'get_deal',
  uriTemplate: 'hubspot://deals/{recordId}',
  description: 'Read a single HubSpot deal by record ID.',
  requiredScopes: ['hubspot.deals.read'],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only — list/search/parameterized reads)
// ---------------------------------------------------------------------------

const searchCrmObjects: CapabilityTool = {
  kind: 'tool',
  name: 'search_crm_objects',
  description: 'Search and filter HubSpot CRM records for any object type (contacts, companies, deals, tickets, ...).',
  requiredScopes: ['hubspot.crm.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      objectType: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'number' },
      after: { type: 'string' },
    },
    required: ['objectType'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listProperties: CapabilityTool = {
  kind: 'tool',
  name: 'list_properties',
  description: 'List or search HubSpot property definitions for a CRM object type.',
  requiredScopes: ['hubspot.schemas.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      objectType: { type: 'string' },
      keywords: { type: 'array', items: { type: 'string' } },
    },
    required: ['objectType'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const searchOwners: CapabilityTool = {
  kind: 'tool',
  name: 'search_owners',
  description: 'Find HubSpot CRM record owners by name, email, or owner ID.',
  requiredScopes: ['hubspot.owners.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      ownerIds: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
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

const getCampaignAnalytics: CapabilityTool = {
  kind: 'tool',
  name: 'get_campaign_analytics',
  description: 'Get HubSpot marketing campaign analytics for one or more campaigns.',
  requiredScopes: ['hubspot.campaigns.read'],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      campaignIds: { type: 'array', items: { type: 'string' } },
      metricType: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
    required: ['campaignIds'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const hubspotManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'hubspot',
  version: '0.0.0',
  displayName: 'HubSpot (BR-72 read-only benchmark proof)',
  resources: [getUserDetails, getContact, getCompany, getDeal],
  tools: [searchCrmObjects, listProperties, searchOwners, getCampaignAnalytics],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [
      'hubspot.contacts.read',
      'hubspot.companies.read',
      'hubspot.deals.read',
      'hubspot.crm.read',
      'hubspot.schemas.read',
      'hubspot.owners.read',
      'hubspot.campaigns.read',
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
      name: 'hubspotAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'manual',
      description: 'HubSpot MCP OAuth2 access token — state-only visibility, value never disclosed.',
    },
  ],
};
