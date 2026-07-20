/**
 * BR-72 DEPTH Lot 2 — `ConnectorRegistry` / `McpProviderBroker` /
 * `createInMemoryContext` HERMETIC unit tests.
 *
 * NO REAL NETWORK CALL — registers a MOCK `AppConnectorProviderAdapter` (not
 * github, not any real connector) to keep this suite connector-agnostic on
 * purpose. See `../scripts/smoke-broker-github.mjs` for the real-network
 * proof that mounts the actual github live adapter (BR-72 DEPTH Lot 1).
 */
import { describe, expect, it } from 'vitest';
import type {
  AppCapability,
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
  ConnectorTenantContext,
  DurableCallRef,
} from '../../mcp-platform/src/runtime.js';
import { McpProviderBroker, UnknownConnectorError } from '../src/broker.js';
import { createInMemoryContext } from '../src/context.js';
import { ConnectorRegistry, DuplicateConnectorError } from '../src/registry.js';

const readOnlyGates: CapabilityGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

const getThing: CapabilityResource = {
  kind: 'resource',
  name: 'get_thing',
  uriTemplate: 'mock://things/{id}',
  description: 'Read a mock thing by id.',
  requiredScopes: [],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const doThing: CapabilityTool = {
  kind: 'tool',
  name: 'do_thing',
  description: 'Do a mock thing.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const durableThing: CapabilityTool = {
  kind: 'tool',
  name: 'durable_thing',
  description: 'A tool whose invocation returns a DurableCallRef.',
  requiredScopes: [],
  requiredClaims: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const mockManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'mock',
  version: '0.0.0',
  displayName: 'Mock Connector',
  resources: [getThing],
  tools: [doThing, durableThing],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [],
    tenantResolution: 'connector-instance',
  },
  audit: { eventKinds: [] },
  durability: {},
};

function makeMockAdapter(connectorId = 'mock'): AppConnectorProviderAdapter {
  return {
    appId: 'sentropic',
    connectorId,
    manifest: mockManifest,
    async resolveTenant(input): Promise<ConnectorTenantContext> {
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
      };
    },
    async listCapabilities(_ctx: ConnectorTenantContext): Promise<AppCapability[]> {
      return [...mockManifest.resources, ...mockManifest.tools, ...mockManifest.prompts];
    },
    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      return {
        ok: true,
        output: { uri: req.input.uri, capabilityRef: req.capabilityRef },
        auditId: 'mock-resource-audit',
        redactionClass: 'low',
      };
    },
    async invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef> {
      if (req.capabilityRef === 'durable_thing') {
        return 'durable-call-ref-123';
      }
      return {
        ok: true,
        output: { received: req.input, capabilityRef: req.capabilityRef },
        auditId: 'mock-tool-audit',
        redactionClass: 'none',
      };
    },
    async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> {
      return [{ name: 'mockSecret', scope: 'connector-instance', state: 'active' }];
    },
  };
}

describe('createInMemoryContext (BR-72 DEPTH Lot 2)', () => {
  it('produces a contract-complete StpConnectorContext with all required fields', async () => {
    const ctx = createInMemoryContext();

    expect(typeof ctx.requestId).toBe('string');
    expect(ctx.requestId.length).toBeGreaterThan(0);
    expect(typeof ctx.correlationId).toBe('string');
    expect(typeof ctx.auditId).toBe('string');

    expect(ctx.principal.sub).toBeTruthy();
    expect(ctx.principal.claims).toEqual({});
    expect(Array.isArray(ctx.principal.scopes)).toBe(true);
    expect(ctx.principal.tenantRef).toBeTruthy();
    expect(typeof ctx.principal.authTime).toBe('string');

    expect(typeof ctx.surface).toBe('string');
    expect(typeof ctx.session.mcpSessionId).toBe('string');
    expect(ctx.tenantRef).toBeTruthy();
    expect(ctx.connectorInstanceId).toBeTruthy();
    expect(ctx.consentRefs).toEqual([]);
    expect(ctx.grantRefs).toEqual([]);
    expect(typeof ctx.getSecret).toBe('function');
    await expect(ctx.getSecret('anything')).resolves.toBe('');
    expect(ctx.connectorConfig).toEqual({});
    expect(typeof ctx.audit.emit).toBe('function');
    expect(ctx.logger).toBeDefined();
  });

  it('routes getSecret through an injected secretResolver (the future EnrollmentStore PORT seam)', async () => {
    const ctx = createInMemoryContext({
      secretResolver: (name) => (name === 'wanted' ? 'resolved-value' : ''),
    });

    await expect(ctx.getSecret('wanted')).resolves.toBe('resolved-value');
    await expect(ctx.getSecret('other')).resolves.toBe('');
  });

  it('accepts overrides for principalSub/tenantRef/connectorInstanceId', () => {
    const ctx = createInMemoryContext({
      principalSub: 'p-1',
      tenantRef: 't-1',
      connectorInstanceId: 'ci-1',
    });

    expect(ctx.principal.sub).toBe('p-1');
    expect(ctx.principal.tenantRef).toBe('t-1');
    expect(ctx.tenantRef).toBe('t-1');
    expect(ctx.connectorInstanceId).toBe('ci-1');
  });
});

describe('ConnectorRegistry (BR-72 DEPTH Lot 2)', () => {
  it('registers, gets and lists adapters keyed by connectorId', () => {
    const registry = new ConnectorRegistry();
    const adapter = makeMockAdapter('mock');

    registry.register(adapter);

    expect(registry.get('mock')).toBe(adapter);
    expect(registry.list()).toEqual(['mock']);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('throws DuplicateConnectorError on a duplicate register() for the same connectorId', () => {
    const registry = new ConnectorRegistry();
    registry.register(makeMockAdapter('mock'));

    expect(() => registry.register(makeMockAdapter('mock'))).toThrow(DuplicateConnectorError);
  });
});

describe('McpProviderBroker (BR-72 DEPTH Lot 2, hermetic mock adapter)', () => {
  function makeBroker() {
    const registry = new ConnectorRegistry();
    registry.register(makeMockAdapter('mock'));
    return new McpProviderBroker({ registry });
  }

  it('listConnectors() reflects the registry', () => {
    const broker = makeBroker();
    expect(broker.listConnectors()).toEqual(['mock']);
  });

  it('listCapabilities() calls the adapter contract (resolveTenant then listCapabilities)', async () => {
    const broker = makeBroker();
    const capabilities = await broker.listCapabilities('mock');
    const names = capabilities.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['get_thing', 'do_thing', 'durable_thing']));
  });

  it('invoke() dispatches a resource capability to readResource, building the URI from uriTemplate', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'get_thing', { id: 42 });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ uri: 'mock://things/42', capabilityRef: 'get_thing' });
    expect(result.auditId).toBe('mock-resource-audit');
  });

  it('invoke() dispatches a tool capability to invokeTool, forwarding input as-is', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'do_thing', { foo: 'bar' });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ received: { foo: 'bar' }, capabilityRef: 'do_thing' });
    expect(result.auditId).toBe('mock-tool-audit');
  });

  it('invoke() throws a typed UnknownConnectorError for an unmounted connectorId', async () => {
    const broker = makeBroker();
    await expect(broker.invoke('nope', 'get_thing', {})).rejects.toThrow(UnknownConnectorError);
    await expect(broker.invoke('nope', 'get_thing', {})).rejects.toMatchObject({
      code: 'unknown_connector',
      connectorId: 'nope',
    });
  });

  it('invoke() returns an unknown_capability error envelope for a capabilityRef not in the manifest', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'no_such_capability', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unknown_capability');
  });

  it('invoke() returns an error envelope (not a throw) when a resource uriTemplate param is missing', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'get_thing', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('missing_resource_uri_param');
  });

  it('invoke() throws when invokeTool returns a DurableCallRef (guarded, unsupported by this in-memory broker)', async () => {
    const broker = makeBroker();
    await expect(broker.invoke('mock', 'durable_thing', {})).rejects.toThrow(/DurableCallRef/);
  });

  it('invoke() accepts a pre-built ctx via opts.ctx instead of the default context factory', async () => {
    const broker = makeBroker();
    const ctx = createInMemoryContext({ principalSub: 'custom-principal' });
    const result = await broker.invoke('mock', 'do_thing', {}, { ctx });

    expect(result.ok).toBe(true);
  });
});
