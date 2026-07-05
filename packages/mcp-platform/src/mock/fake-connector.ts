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
  DurableCallRef,
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

// Long-running, workflow-backed export. Returns a DurableCallRef (§8) instead of
// an inline result — read-only, but the work outlives a single interaction.
const exportWidgets: CapabilityTool = {
  kind: 'tool',
  name: 'export_widgets',
  description: 'Export all widgets — long-running, workflow-backed; returns a DurableCallRef (§8).',
  requiredScopes: ['widgets:read'],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: { format: { type: 'string' } } },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

export const fakeManifest: AppMcpProviderManifest = {
  appId: 'fake-app',
  providerId: 'fake-widgets',
  version: '0.0.0',
  displayName: 'Fake widgets connector',
  resources: [listWidgets],
  tools: [createWidget, exportWidgets],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['widgets:read', 'widgets:write'],
    tenantResolution: 'connector-instance',
    freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  },
  audit: { eventKinds: ['tool.invoke', 'secret.access'], piiClass: 'low' },
  durability: { longRunningTools: ['export_widgets'], workflowBackedTools: ['export_widgets'] },
  secrets: [{ name: 'fakeAccessToken', scope: 'connector-instance', sensitive: true, rotation: 'manual' }],
};

/** Dependencies wiring a long-running tool to the §8 durable-call layer. */
export type FakeConnectorDeps = {
  /** Launches a durable call for a long-running tool and returns its ref (§8). */
  launchDurable?: (req: AppToolInvocation) => DurableCallRef;
};

export function createFakeConnector(deps: FakeConnectorDeps = {}): AppConnectorProviderAdapter {
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
      return [listWidgets, createWidget, exportWidgets];
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
      // Long-running capability: never returns inline — hand back a DurableCallRef (§8).
      if (req.capabilityRef === exportWidgets.name) {
        if (!deps.launchDurable) {
          return {
            ok: false,
            auditId: req.ctx.auditId,
            redactionClass: exportWidgets.redactionClass,
            error: { code: 'durable_backend_unavailable', message: 'no durable-call backend wired', retriable: true },
          };
        }
        return deps.launchDurable(req);
      }
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
