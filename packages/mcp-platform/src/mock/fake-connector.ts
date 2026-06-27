/**
 * Slice 2 — App-neutral fake connector adapter fixture.
 *
 * Implements the §4.4 `AppConnectorProviderAdapter` against a deliberately
 * generic "widgets" domain. NO Wave/immo shape is baked in — this exists solely
 * to exercise the platform harness. `resolveTenant` MAY ONLY narrow within the
 * core-authorized principal→tenant binding; it never broadens or re-binds it.
 *
 * MOCK-ONLY: pure in-memory; no network, no DB, no real credentials.
 */
import type {
  AppMcpProviderManifest,
  CapabilityResource,
  CapabilityTool,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '../manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
} from '../runtime.js';

const listWidgets: CapabilityResource = {
  kind: 'resource',
  name: 'list_widgets',
  uriTemplate: 'fake://{tenant}/widgets',
  description: 'List widgets in the resolved tenant scope.',
  requiredScopes: ['widgets:read'],
  requiredClaims: [],
  outputSchema: { type: 'array' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

const createWidget: CapabilityTool = {
  kind: 'tool',
  name: 'create_widget',
  description: 'Create a widget (external mutation).',
  requiredScopes: ['widgets:write'],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: { label: { type: 'string' } } },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'append',
  mutatesExternalSystem: true,
  idempotency: { required: true, scope: 'tenant' },
  freshness: { maxAgeSeconds: 300, stepUp: 'auth' },
  gates: { requiresElicitation: true, requiresHumanConfirmation: true, requiresPrincipalGate: false },
};

export const fakeManifest: AppMcpProviderManifest = {
  appId: 'fake-app',
  providerId: 'fake-widgets',
  version: '0.0.0',
  displayName: 'Fake widgets connector',
  resources: [listWidgets],
  tools: [createWidget],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['widgets:read', 'widgets:write'],
    tenantResolution: 'connector-instance',
    freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  },
  audit: { eventKinds: ['tool.invoke', 'secret.access'], piiClass: 'low' },
  durability: {},
  secrets: [{ name: 'fakeAccessToken', scope: 'connector-instance', sensitive: true, rotation: 'manual' }],
};

export function createFakeConnector(): AppConnectorProviderAdapter {
  return {
    appId: fakeManifest.appId,
    connectorId: fakeManifest.providerId,
    manifest: fakeManifest,

    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      // Narrow-only: keep the core-authorized tenant; map to a domain scope only.
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef, // never re-bound from selectorHints
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
        domainScopeRef: `widget-space:${input.tenantRef}`,
      };
    },

    async listCapabilities() {
      return [listWidgets, createWidget];
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult> {
      const input = req.input as { label?: string };
      return {
        ok: true,
        output: { id: `widget-${input.label ?? 'unnamed'}`, tenantRef: req.ctx.tenantRef },
        auditId: req.ctx.auditId,
        redactionClass: createWidget.redactionClass,
      };
    },

    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      return {
        ok: true,
        output: { uri: req.input.uri, items: [], tenantRef: req.ctx.tenantRef },
        auditId: req.ctx.auditId,
        redactionClass: listWidgets.redactionClass,
      };
    },

    async validateSecrets() {
      return [{ name: 'fakeAccessToken', scope: 'connector-instance', state: 'active' }];
    },
  };
}
