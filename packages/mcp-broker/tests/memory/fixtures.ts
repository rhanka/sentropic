/** Shared deterministic broker memory test fixtures (not a test file). */
import type {
  AppCapability,
  AppConnectorProviderAdapter,
  StpConnectorContext,
} from '@sentropic/mcp-platform';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import { MEMORY_TOOLS } from '@sentropic/mcp-platform/memory';

import { hostContext } from '../../../mcp-platform/tests/memory/host-fixture.js';
export function makeCtx(overrides: Record<string, unknown> = {}): StpConnectorContext {
  return { ...hostContext(), ...overrides } as StpConnectorContext;
}

export function makeMemoryAdapter(connectorId = 'engram-memory'): AppConnectorProviderAdapter {
  return {
    appId: 'engram',
    connectorId,
    manifest: {
      appId: 'engram',
      providerId: 'sentropic.engram.memory',
      version: '1.0.0',
      displayName: 'Engram Memory',
      resources: [],
      tools: [...MEMORY_TOOLS],
      prompts: [],
      authz: { requiredClaims: ['sub', 'tid'], scopes: ['mcp:tools:invoke'], tenantResolution: 'custom-resolver' },
      audit: { eventKinds: ['invoke'] },
      durability: {},
    },
    async resolveTenant(input) {
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
      };
    },
    async listCapabilities() {
      return [...MEMORY_TOOLS] as AppCapability[];
    },
    async invokeTool(req) {
      return {
        ok: true,
        output: { schema_version: 1, value: { capabilityRef: req.capabilityRef } },
        auditId: 'mock-memory-audit',
        redactionClass: 'high',
      };
    },
    async readResource() {
      throw new Error('no resources');
    },
    async validateSecrets() {
      return [];
    },
  };
}

export function makePlan(toolNames: string[] = ['engram_memory_search']): CompiledMcpRegistry {
  const resolutions = new Map(
    toolNames.map((name) => [
      name,
      {
        providerId: 'sentropic.engram.memory',
        capabilityName: name,
        values: {},
        requiredScopes: ['mcp:tools:invoke'],
        requiredClaims: ['sub', 'tid'],
        entry: {
          toolName: name,
          capabilityRef: name,
          handlerId: 'memory-handler',
          values: {},
          requiredScopes: ['mcp:tools:invoke'],
          requiredClaims: ['sub', 'tid'],
          mutability: 'read-only',
          mutatesExternalSystem: false,
          idempotency: { required: false },
          redactionClass: 'high',
          gates: {
            requiresElicitation: false,
            requiresHumanConfirmation: false,
            requiresPrincipalGate: false,
            requiresPolicy: true,
          },
        },
      },
    ]),
  );
  return {
    providers: new Map([
      [
        'sentropic.engram.memory',
        {
          providerId: 'sentropic.engram.memory',
          version: '1.0.0',
          manifestDigest: 'manifest-1',
          values: {},
          tools: [],
        },
      ],
    ]),
    tools: resolutions,
    resolveTool: (name: string) => resolutions.get(name),
  };
}

export function selectInput(overrides: Record<string, unknown> = {}) {
  return {
    toolName: 'engram_memory_search',
    ctx: makeCtx(),
    purposeRef: 'purpose-1',
    idempotencyKey: '0123456789abcdef',
    expectedPrincipalSub: 'user-1',
    expectedTenantRef: 'tenant-1',
    expectedSourceId: 'mcp:engram-memory',
    expectedGeneration: '1',
    ...overrides,
  };
}

