/**
 * Lot 7 — mesh composition over the compiled plan: `createMcpNamespaceModule`
 * preflights the platform leaves, then serves `/mcp` through per-request
 * verified servers. B1: every request is verified through the mesh
 * verified-invocation context port (401 when unverified); the runner chain
 * uses the verified-derived identity only — client headers are never
 * authority. `authorizeDispatch` enforces the compiled plan before the host
 * invocation guard and runner; a refusal stops before any tool effect.
 * A missing platform fails startup.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ClusterMeshModules } from '../src/modules/contracts.js';
import { createMcpNamespaceModule } from '../src/compose/mcp.js';
import { createMcpRegistry } from '../src/mcp/registry.js';

const kernelModules = (): ClusterMeshModules =>
  ({
    load: async (id: string) => {
      if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
      if (id === 'mcp-platform/bridge') return import('@sentropic/mcp-platform/transport/bridge');
      if (id === 'mcp-platform/hono') return import('@sentropic/mcp-platform/hono');
      throw new Error(`unexpected module load in composition spec: ${id}`);
    },
  }) as unknown as ClusterMeshModules;

const MANIFEST = {
  appId: 'probe-app',
  providerId: 'immo',
  version: '0.0.0',
  displayName: 'Probe immo',
  resources: [],
  tools: [
    {
      kind: 'tool',
      name: 'immo_search',
      description: 'Synthetic.',
      requiredScopes: ['probe:use'],
      requiredClaims: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      redactionClass: 'low',
      mutability: 'read-only',
      mutatesExternalSystem: false,
      idempotency: { required: false },
      gates: {
        requiresElicitation: false,
        requiresHumanConfirmation: false,
        requiresPrincipalGate: false,
      },
    },
  ],
  prompts: [],
  authz: { requiredClaims: [], scopes: ['probe:use'], tenantResolution: 'connector-instance' },
  audit: { eventKinds: ['invoke'] },
  durability: {},
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

const LIMIT_SCHEMA = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

async function compiledRegistry() {
  const facade = createMcpRegistry({ modules: kernelModules() });
  facade.register({
    manifest: MANIFEST,
    adapter: { appId: 'probe-app', connectorId: 'probe' },
    parameterSchema: { properties: {}, required: [] },
    handlers: {
      'immo_search-handler': {
        handlerId: 'immo_search-handler',
        capabilityRef: 'immo_search',
        configSchema: LIMIT_SCHEMA,
      },
    },
    requiredPorts: [],
    provenance: { approvalRef: 'a', revision: 'r', manifestDigest: 'm', reviewedBy: ['probe-owner'] },
    toolValues: { immo_search: { handlerId: 'immo_search-handler', values: { limit: 20 } } },
  } as never);
  facade.select(['immo']);
  const compiled = await facade.compile({
    bindings: {},
    compatibility: { immo: { manifestDigest: computeManifestDigest(MANIFEST) } },
  });
  if (!compiled.ok) throw new Error('fixture must compile');
  return compiled.registry;
}

const auth = () => {
  const routes = new Hono().get('/.well-known/x', (c) => c.json({ ok: true }));
  return {
    routes,
    scopes: { discover: 'mcp:discover', invoke: 'mcp:tools:invoke', read: 'mcp:resources:read' },
    require: () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
    context: () => ({ sub: 'user-1', clientId: 'c', tid: null, scopes: [] }),
  };
};

const ports = (context: VerifiedInvocationContextPort) => ({
  context,
  receipts: {} as InvocationReceiptPort,
});

/** Controllable verified-invocation context double (B1: authenticity failures throw). */
const verifiedContext = (options: {
  scopes?: string[];
  principalId?: string;
  workspaceId?: string;
  fail?: boolean;
} = {}): VerifiedInvocationContextPort =>
  ({
    verify: async (input: unknown) => {
      void input;
      if (options.fail === true) throw new Error('unverified-test');
      return {
        invocationId: 'inv-1',
        correlationId: 'corr-1',
        generationId: 'test-generation',
        principal: {
          principalId: options.principalId ?? 'user-1',
          kind: 'human',
          verifierId: 'test-verifier',
        },
        workspace: {
          bindingId: 'b-1',
          workspaceId: options.workspaceId ?? 'tenant-1',
          revision: 'r-1',
        },
        scopes: [...(options.scopes ?? ['probe:use'])],
        policyRevision: 'rev-1',
        issuedAt: new Date(1_700_000_000_000).toISOString(),
      };
    },
  }) as unknown as VerifiedInvocationContextPort;

const parseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (contentType.includes('application/json')) return JSON.parse(text);
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) throw new Error(`no SSE data: ${text.slice(0, 120)}`);
  return JSON.parse(dataLine.slice('data:'.length).trim());
};

const rpc = (router: Hono, body: unknown, headers: Record<string, string> = {}) =>
  router.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });

async function initialize(router: Hono, headers: Record<string, string> = {}) {
  const response = await rpc(router, {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
  }, headers);
  expect(response.status).toBe(200);
  const notified = await rpc(router, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
  expect([200, 202]).toContain(notified.status);
}

describe('mesh mcp composition', () => {
  it('serves the compiled plan over /mcp with verified identity only', async () => {
    const seen: unknown[] = [];
    let effects = 0;
    const module = await createMcpNamespaceModule(kernelModules(), {
      registry: await compiledRegistry(),
      tools: [{ name: 'immo_search', description: 'Synthetic', schema: SCHEMA }],
      runner: {
        run: async (_tool, args, identity) => {
          seen.push(identity);
          effects += 1;
          return { ok: true, output: { echo: args }, auditId: 'a', redactionClass: 'low' };
        },
      },
      auth: auth() as never,
      contextResolver: async (identity) => ({
        sub: identity?.clientId ?? 'anonymous',
        clientId: identity?.clientId ?? 'anonymous',
        tid: identity?.tenantRef ?? null,
        scopes: [...(identity?.scopes ?? [])],
      }),
      invocation: { authorize: async () => ({ allowed: true as const }) },
      createTransport: () => new WebStandardStreamableHTTPServerTransport(),
      generationId: 'test-generation',
    });
    expect(module.namespace).toBe('/mcp');
    expect(module.enabled).toBe(true);
    const router = module.createRouter(ports(verifiedContext()));
    const forged = {
      'x-mcp-client-id': 'mallory',
      'x-mcp-tenant-ref': 't-9',
      'x-mcp-scopes': 'admin:*',
    };
    await initialize(router, forged);
    const called = await parseBody(
      await rpc(router, {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'immo_search', arguments: { surface: 80 } },
      }, forged),
    );
    expect(called).toMatchObject({
      result: { isError: false, content: [{ type: 'text', text: '{"echo":{"surface":80}}' }] },
    });
    expect(effects).toBe(1);
    expect(seen).toEqual([{ clientId: 'user-1', tenantRef: 'tenant-1', scopes: ['probe:use'], hasBearer: true }]);
  });

  it('refuses unverified invocations on /mcp with 401 before any effect', async () => {
    let effects = 0;
    const module = await createMcpNamespaceModule(kernelModules(), {
      registry: await compiledRegistry(),
      tools: [{ name: 'immo_search', schema: SCHEMA }],
      runner: {
        run: async () => {
          effects += 1;
          return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
        },
      },
      auth: auth() as never,
      contextResolver: async () => ({ sub: 'x', clientId: 'x', tid: null, scopes: [] }),
      invocation: { authorize: async () => ({ allowed: true as const }) },
      createTransport: () => new WebStandardStreamableHTTPServerTransport(),
      generationId: 'test-generation',
    });
    const router = module.createRouter(ports(verifiedContext({ fail: true })));
    const response = await rpc(router, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
    });
    expect(response.status).toBe(401);
    expect(effects).toBe(0);
  });

  it('refuses forged scopes with insufficient_scope and no tool effect', async () => {
    let effects = 0;
    const module = await createMcpNamespaceModule(kernelModules(), {
      registry: await compiledRegistry(),
      tools: [{ name: 'immo_search', schema: SCHEMA }],
      runner: {
        run: async () => {
          effects += 1;
          return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
        },
      },
      auth: auth() as never,
      contextResolver: async (identity) => ({
        sub: identity?.clientId ?? 'anonymous',
        clientId: identity?.clientId ?? 'anonymous',
        tid: identity?.tenantRef ?? null,
        scopes: [...(identity?.scopes ?? [])],
      }),
      invocation: { authorize: async () => ({ allowed: true as const }) },
      createTransport: () => new WebStandardStreamableHTTPServerTransport(),
      generationId: 'test-generation',
    });
    const router = module.createRouter(ports(verifiedContext({ scopes: [] })));
    const forged = { 'x-mcp-scopes': 'probe:use' };
    await initialize(router, forged);
    const called = await parseBody(
      await rpc(router, {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'immo_search', arguments: { surface: 80 } },
      }, forged),
    );
    expect(called).toMatchObject({ result: { isError: true, _meta: { errorCode: 'insufficient_scope' } } });
    expect(effects).toBe(0);
  });

  it('stops a refused call before any tool effect', async () => {
    let effects = 0;
    const module = await createMcpNamespaceModule(kernelModules(), {
      registry: await compiledRegistry(),
      tools: [{ name: 'immo_search', schema: SCHEMA }],
      runner: {
        run: async () => {
          effects += 1;
          return { ok: true, output: {}, auditId: 'a', redactionClass: 'low' };
        },
      },
      auth: auth() as never,
      contextResolver: async () => ({ sub: 'x', clientId: 'x', tid: null, scopes: ['probe:use'] }),
      invocation: { authorize: async () => ({ allowed: false as const, reason: 'denied' }) },
      createTransport: () => new WebStandardStreamableHTTPServerTransport(),
      generationId: 'test-generation',
    });
    const router = module.createRouter(ports(verifiedContext()));
    await initialize(router);
    const called = await parseBody(
      await rpc(router, {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'immo_search', arguments: { surface: 80 } },
      }),
    );
    expect(called).toMatchObject({ result: { isError: true } });
    expect(effects).toBe(0);
  });

  it('refuses a bridge tool outside the compiled plan at startup', async () => {
    await expect(
      createMcpNamespaceModule(kernelModules(), {
        registry: await compiledRegistry(),
        tools: [{ name: 'nope.tool', schema: SCHEMA }],
        runner: { run: async () => ({ ok: true, output: {}, auditId: 'a', redactionClass: 'low' }) },
        auth: auth() as never,
        contextResolver: async () => ({ sub: 'x', clientId: 'x', tid: null, scopes: [] }),
        invocation: { authorize: async () => ({ allowed: true as const }) },
        createTransport: () =>
          new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() }),
        stateful: true,
      }),
    ).rejects.toThrow(/not in the compiled plan/);
  });

  it('refuses startup when the platform is unavailable', async () => {
    const dead = (): ClusterMeshModules =>
      ({
        load: async (id: string) => {
          throw new Error(`unavailable: ${id}`);
        },
      }) as unknown as ClusterMeshModules;
    await expect(
      createMcpNamespaceModule(dead(), {
        registry: await compiledRegistry(),
        tools: [],
        runner: { run: async () => ({ ok: false, auditId: 'a', redactionClass: 'low' }) },
        auth: auth() as never,
        contextResolver: async () => ({ sub: 'x', clientId: 'x', tid: null, scopes: [] }),
        invocation: { authorize: async () => ({ allowed: true as const }) },
        createTransport: () =>
          new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() }),
        stateful: true,
      }),
    ).rejects.toThrow();
  });
});
