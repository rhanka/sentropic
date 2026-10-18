/**
 * MCP-L5 Lot 1 — `McpProviderBroker` plan-bound dispatch tests.
 *
 * Hermetic: registers mock `AppConnectorProviderAdapter`s bound from an
 * immutable compiled plan stub (no real connector). Every invocation
 * carries an explicit verified host context; the broker never manufactures
 * identity.
 */
import { describe, expect, it } from 'vitest';
import type {
  AppCapability,
  AppConnectorProviderAdapter,
  AppMcpProviderManifest,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
  ConnectorSecretStatus,
  ConnectorTenantContext,
  DurableCallRef,
  StpConnectorContext,
} from '@sentropic/mcp-platform';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import { McpProviderBroker, UnknownConnectorError } from '../src/broker.js';
import { DuplicateConnectorError } from '../src/registry.js';

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

function makeCtx(): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-host-1',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: [],
      tenantRef: 'tenant-1',
      authTime: '2026-10-18T00:00:00.000Z',
    },
    surface: 'backend',
    session: { mcpSessionId: 'session-1' },
    tenantRef: 'tenant-1',
    connectorInstanceId: 'mock',
    consentRefs: [],
    grantRefs: [],
    getSecret: async () => '',
    connectorConfig: {},
    audit: { emit: async () => undefined },
    logger: undefined,
  };
}

function makePlan(): CompiledMcpRegistry {
  const names = ['get_thing', 'do_thing', 'durable_thing'];
  const resolutions = new Map(
    names.map((name) => [
      name,
      {
        providerId: 'mock',
        capabilityName: name,
        values: {},
        requiredScopes: [] as string[],
        requiredClaims: [] as string[],
        entry: {
          toolName: name,
          capabilityRef: name,
          handlerId: 'mock-handler',
          values: {},
          requiredScopes: [] as string[],
          requiredClaims: [] as string[],
          mutability: 'read-only' as const,
          mutatesExternalSystem: false,
          idempotency: { required: false },
          redactionClass: 'none' as const,
          gates: readOnlyGates,
        },
      },
    ]),
  );
  return {
    providers: new Map([
      ['mock', { providerId: 'mock', version: '0.0.0', manifestDigest: 'm', values: {}, tools: [] }],
    ]),
    tools: resolutions,
    resolveTool: (name: string) => resolutions.get(name),
  };
}

describe('McpProviderBroker (L5 Lot 1, plan-bound, explicit trusted context)', () => {
  function makeBroker() {
    return new McpProviderBroker({
      plan: makePlan(),
      adapters: [makeMockAdapter('mock')],
      sourceId: 'mcp:mock',
      generation: 'gen-0',
    });
  }

  it('refuses duplicate connector mounts with a typed error', () => {
    expect(
      () =>
        new McpProviderBroker({
          plan: makePlan(),
          adapters: [makeMockAdapter('mock'), makeMockAdapter('mock')],
          sourceId: 'mcp:mock',
          generation: 'gen-0',
        }),
    ).toThrow(DuplicateConnectorError);
  });

  it('listConnectors() reflects the plan-bound adapters', () => {
    expect(makeBroker().listConnectors()).toEqual(['mock']);
  });

  it('listCapabilities() calls the adapter contract with the verified context', async () => {
    const broker = makeBroker();
    const capabilities = await broker.listCapabilities('mock', makeCtx());
    const names = capabilities.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['get_thing', 'do_thing', 'durable_thing']));
  });

  it('invoke() requires a verified context before dispatch', async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke('mock', 'do_thing', {}, { ctx: undefined as unknown as StpConnectorContext }),
    ).rejects.toMatchObject({ code: '-32603', message: 'Trusted invocation context unavailable' });
  });

  it('invoke() dispatches a resource capability to readResource, building the URI from uriTemplate', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'get_thing', { id: 42 }, { ctx: makeCtx() });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ uri: 'mock://things/42', capabilityRef: 'get_thing' });
    expect(result.auditId).toBe('mock-resource-audit');
  });

  it('invoke() dispatches a tool capability to invokeTool, forwarding input as-is', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'do_thing', { foo: 'bar' }, { ctx: makeCtx() });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ received: { foo: 'bar' }, capabilityRef: 'do_thing' });
    expect(result.auditId).toBe('mock-tool-audit');
  });

  it('invoke() throws a typed UnknownConnectorError for an unmounted connectorId', async () => {
    const broker = makeBroker();
    await expect(broker.invoke('nope', 'get_thing', {}, { ctx: makeCtx() })).rejects.toThrow(
      UnknownConnectorError,
    );
    await expect(broker.invoke('nope', 'get_thing', {}, { ctx: makeCtx() })).rejects.toMatchObject({
      code: 'unknown_connector',
      connectorId: 'nope',
    });
  });

  it('invoke() returns an unknown_capability error envelope for a capabilityRef not in the manifest', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'no_such_capability', {}, { ctx: makeCtx() });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unknown_capability');
    expect(result.auditId).toBe('audit-host-1');
  });

  it('invoke() returns an error envelope (not a throw) when a resource uriTemplate param is missing', async () => {
    const broker = makeBroker();
    const result = await broker.invoke('mock', 'get_thing', {}, { ctx: makeCtx() });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('missing_resource_uri_param');
  });

  it('invoke() throws when invokeTool returns a DurableCallRef (guarded, unsupported)', async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke('mock', 'durable_thing', {}, { ctx: makeCtx() }),
    ).rejects.toThrow(/DurableCallRef/);
  });
});
