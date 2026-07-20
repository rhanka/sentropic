/**
 * BR-72 read-only benchmark proof — Stripe connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding: taxonomy-only read of the OOMOL open-connector
 * `src/providers/stripe/actions.ts` / `definition.ts` (single `api_key`
 * auth type, per-action `requiredScopes: []` — Stripe restricted API keys
 * carry no OAuth-style scope strings in that source). No OOMOL code is
 * vendored, wrapped, or copied — every schema/fixture below is recoded
 * independently.
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
// Resources — URI-addressable single-entity reads (OOMOL identify_account /
// get_customer / get_product / get_price)
// ---------------------------------------------------------------------------

const identifyAccount: CapabilityResource = {
  kind: 'resource',
  name: 'identify_account',
  uriTemplate: 'stripe://account',
  description: 'Read the Stripe account associated with the connector-instance secret API key.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getCustomer: CapabilityResource = {
  kind: 'resource',
  name: 'get_customer',
  uriTemplate: 'stripe://customers/{customerId}',
  description: 'Read a single Stripe customer record by ID.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getProduct: CapabilityResource = {
  kind: 'resource',
  name: 'get_product',
  uriTemplate: 'stripe://products/{productId}',
  description: 'Read a single Stripe product record by ID.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getPrice: CapabilityResource = {
  kind: 'resource',
  name: 'get_price',
  uriTemplate: 'stripe://prices/{priceId}',
  description: 'Read a single Stripe price record by ID.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only) — parameterized list/search reads (OOMOL
// list_customers / search_customers / list_products / list_prices)
// ---------------------------------------------------------------------------

const listCustomers: CapabilityTool = {
  kind: 'tool',
  name: 'list_customers',
  description: 'List Stripe customers, optionally filtered by exact email and a cursor.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      email: { type: 'string' },
      starting_after: { type: 'string' },
    },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const searchCustomers: CapabilityTool = {
  kind: 'tool',
  name: 'search_customers',
  description: "Search Stripe customers with Stripe's search query syntax.",
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listProducts: CapabilityTool = {
  kind: 'tool',
  name: 'list_products',
  description: 'List Stripe products, optionally filtered by active status and a cursor.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      active: { type: 'boolean' },
      starting_after: { type: 'string' },
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

const listPrices: CapabilityTool = {
  kind: 'tool',
  name: 'list_prices',
  description: 'List Stripe prices, optionally filtered by product, active status, and a cursor.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      product: { type: 'string' },
      active: { type: 'boolean' },
      starting_after: { type: 'string' },
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

export const stripeManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'stripe',
  version: '0.0.0',
  displayName: 'Stripe (BR-72 read-only benchmark proof)',
  resources: [identifyAccount, getCustomer, getProduct, getPrice],
  tools: [listCustomers, searchCustomers, listProducts, listPrices],
  prompts: [],
  authz: {
    requiredClaims: [],
    // Faithful to the OOMOL source: every stripe action declares
    // `requiredScopes: []` (single `api_key` auth type, no OAuth scopes).
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
      name: 'stripeApiKey',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
      description: 'Stripe secret or restricted API key — state-only visibility, value never disclosed.',
    },
  ],
};
