/**
 * Lot 7 — mesh composition over the compiled plan
 * (`@sentropic/cluster-mesh/compose/mcp`, spec-v8 §3).
 *
 * Preflights the platform leaves (bridge + hono mount) before anything
 * binds, checks bridge/plan coherence (every bridge tool resolves by exact
 * name in the compiled registry), then serves `/mcp` through per-request
 * verified servers. B1: every `/mcp` request is verified through the mesh
 * verified-invocation context port (401 when unverified); the per-request
 * runner chain uses the verified-derived identity only — client headers are
 * never authority (the bridge forwards the host mount identity only).
 * Authorization chains per call: verified identity → host `contextResolver`
 * → compiled-plan `policy` (`authorizeDispatch`) → host `invocation` guard
 * → host `runner`. A refusal stops before any tool effect. The classic
 * `/invoke` path routes through the same policy-guarded chain with the
 * host-verified principal. Per-request servers are required: a shared
 * server cannot bind per-request verified principals, so `stateful` mounts
 * are unsupported here (the platform host-owned mount keeps its own mode).
 */
import '../modules/topology-guard-mcp.js';
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  VerifiedInvocationContext,
  VerifiedInvocationContextPort,
} from '@sentropic/contracts';
import { authorizeDispatch, authorizeVerifiedMemoryDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import { isMemoryToolName, projectMemoryContext, requireTrustedInvocationContext, MemoryTrustedContextError,
  type StpConnectorContext } from '@sentropic/mcp-platform/memory';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadMcpPlatformBridge } from '../loaders/mcp/bridge.js';
import { loadMcpPlatformHono } from '../loaders/mcp/hono.js';
import type {
  CompiledMcpRegistry,
  CompiledToolResolution,
} from '@sentropic/mcp-platform/registry';
import type {
  BridgeRunner,
  BridgeTool,
  RequestIdentity,
  BridgeInvocation,
} from '@sentropic/mcp-platform/transport/bridge';
import type {
  McpHonoOptions,
  McpInvocation,
  McpPrincipal,
} from '@sentropic/mcp-platform/hono';
import type { AppToolResult } from '@sentropic/mcp-platform/transport/bridge';

export interface McpInvocationGuard {
  authorize(input: {
    operation: 'invoke';
    principal: McpPrincipal;
    tool: string;
  }): Promise<{ allowed: true } | { allowed: false; reason: string; status?: 403 | 409 | 503 }>;
}

export interface McpNamespaceOptions {
  registry: CompiledMcpRegistry;
  tools: readonly BridgeTool[];
  runner: BridgeRunner;
  auth: McpHonoOptions['auth'];
  contextResolver(
    identity: RequestIdentity | undefined,
  ): McpPrincipal | Promise<McpPrincipal>;
  invocation: McpInvocationGuard;
  createTransport(): WebStandardStreamableHTTPServerTransport;
  /**
   * Runtime generation id bound into every verified `/mcp` invocation
   * (mirrors the mesh invocation context contract; host-supplied).
   */
  generationId: string;
  /** Resolve all frozen host bindings per tool call from the verified attachment. */
  memoryContext?(verified: VerifiedInvocationContext, tool: string, signal: AbortSignal): Promise<StpConnectorContext>;
}

/**
 * Compiled-plan policy hook: runs after principal resolution, before the
 * host invocation guard. Reasons become stable wire error codes, so they
 * must be kebab-case plan codes (see `createRegistryPolicy`).
 */
export interface GuardedRunnerPolicy {
  authorize(input: { tool: string; principal: McpPrincipal; context?: StpConnectorContext }): Promise<
    { allowed: true } | { allowed: false; reason: string; status?: 403 | 409 | 503 }
  >;
}

export interface GuardedRunnerOptions {
  contextResolver(
    identity: RequestIdentity | undefined,
  ): McpPrincipal | Promise<McpPrincipal>;
  invocation: McpInvocationGuard;
  runner: BridgeRunner;
  policy?: GuardedRunnerPolicy;
}

/** Compiled-plan policy over `authorizeDispatch` (unknown tool/scope/claims). */
export function createRegistryPolicy(registry: CompiledMcpRegistry): GuardedRunnerPolicy {
  return {
    authorize: async ({ tool, principal, context }) => {
      if (isMemoryToolName(tool) && !context) throw new MemoryTrustedContextError();
      const decision = isMemoryToolName(tool) ? authorizeVerifiedMemoryDispatch({ registry, toolName: tool, context: context! }) : authorizeDispatch({
        registry,
        toolName: tool,
        principal: {
          sub: principal.sub,
          clientId: principal.clientId,
          scopes: [...principal.scopes],
          claims: [],
        },
      });
      if (decision.allowed) return { allowed: true as const };
      return {
        allowed: false as const,
        reason: decision.code,
        status: (decision.code === 'unknown_tool' ? 409 : 403) as 403 | 409,
      };
    },
  };
}

type GuardedRun = (
  tool: string,
  args: Parameters<BridgeRunner['run']>[1],
  identity: RequestIdentity | undefined,
  call?: BridgeInvocation,
) => Promise<AppToolResult>;

/** Chain verified identity → context → plan policy → guard → runner; refusals stop before effects. */
export function createGuardedRunner(options: GuardedRunnerOptions): BridgeRunner {
  return {
    run: async (tool, args, identity, call) => {
      const ctx = isMemoryToolName(tool) ? requireTrustedInvocationContext(call?.context) : undefined;
      if (ctx) {
        projectMemoryContext(ctx, typeof args.purpose_ref === 'string' ? args.purpose_ref : ctx.memory!.binding.purpose_ref);
        call!.signal.throwIfAborted();
      }
      const principal = ctx ? { sub: ctx.principal.sub, clientId: ctx.mcpClient!.clientId,
        tid: ctx.tenantRef, scopes: [...ctx.principal.scopes] } : await options.contextResolver(identity);
      if (options.policy !== undefined) {
        const policy = await options.policy.authorize({ tool, principal, ...(ctx ? { context: ctx } : {}) });
        if (!policy.allowed) {
          if (ctx) return refused('UNAUTHORIZED', 'Memory invocation refused', ctx);
          return {
            ok: false,
            auditId: 'namespace-guard',
            redactionClass: 'low',
            error: { code: policy.reason, message: policy.reason, retriable: false },
          };
        }
      }
      const decision = await options.invocation.authorize({ operation: 'invoke', principal, tool });
      if (!decision.allowed) {
        if (ctx) return refused('UNAUTHORIZED', 'Memory invocation refused', ctx);
        return {
          ok: false,
          auditId: 'namespace-guard',
          redactionClass: 'low',
          error: { code: 'invocation_refused', message: decision.reason, retriable: false },
        };
      }
      call?.signal.throwIfAborted();
      if (ctx) projectMemoryContext(ctx, ctx.memory!.binding.purpose_ref);
      return options.runner.run(tool, args, ctx ? toRequestIdentity(principal) : identity, call);
    },
  };
}

function refused(code: string, message: string, ctx?: StpConnectorContext): AppToolResult {
  return {
    ok: false,
    auditId: ctx?.auditId ?? 'namespace-guard',
    redactionClass: ctx ? 'high' : 'low',
    error: { code, message, retriable: false },
  };
}

/**
 * Prepare the `/mcp` namespace at composition startup. Missing or
 * incompatible platform leaves, and bridge tools outside the compiled plan,
 * fail startup before any listener binds.
 */
export async function createMcpNamespaceModule(
  modules: ClusterMeshModules,
  options: McpNamespaceOptions,
): Promise<ClusterMeshHonoNamespaceModule> {
  const [bridge, hono] = await Promise.all([
    loadMcpPlatformBridge(modules),
    loadMcpPlatformHono(modules),
  ]);
  bridge.admitBridgeTools(options.tools);
  if (options.tools.some(tool => isMemoryToolName(tool.name)) && !options.memoryContext) {
    throw new MemoryTrustedContextError('memory host resolver required');
  }
  for (const tool of options.tools) {
    const resolution: CompiledToolResolution | undefined = options.registry.resolveTool(tool.name);
    if (resolution === undefined) {
      throw new Error(`Bridge tool '${tool.name}' is not in the compiled plan`);
    }
  }
  const policy = createRegistryPolicy(options.registry);
  const guardedRunner = createGuardedRunner({
    contextResolver: options.contextResolver,
    invocation: options.invocation,
    runner: options.runner,
    policy,
  });
  const guardedRun: GuardedRun = (tool, args, identity) => guardedRunner.run(tool, args, identity);
  return {
    namespace: '/mcp',
    enabled: true,
    createRouter: ({ context }): Hono => {
      const router = hono.createMcpPlatformHono({
        auth: options.auth,
        connector: {
          invoke: async (request: McpInvocation) =>
            guardedRun(
              request.capabilityRef,
              request.input as Parameters<BridgeRunner['run']>[1],
              toRequestIdentity(request.principal),
            ),
          readResource: async () =>
            refused('unsupported_operation', 'Resource reads are not served by this namespace'),
        },
      });
      router.all('/mcp', async (c) => {
        const verified = await verifyMcpInvocation(context, options.generationId, c);
        if (verified === null) {
          return c.json(
            {
              error: {
                code: 'unverified_invocation',
                message: 'Invocation context could not be verified.',
              },
            },
            401,
          );
        }
        const principal = await options.contextResolver(identityFromVerified(verified));
        const requestRunner = createGuardedRunner({
          contextResolver: async () => principal,
          invocation: options.invocation,
          runner: { run: (tool, args, identity, call) => options.runner.run(tool, args, call ? identity : toRequestIdentity(principal), call) },
          policy,
        });
        const server = new SdkServer(
          { name: '@sentropic/cluster-mesh/mcp', version: '0.18.0' },
          { capabilities: { tools: {} } },
        );
        bridge.registerBridgeTools(server, options.tools, requestRunner, {
          memoryContext: async (tool, signal) => {
            const ctx = requireTrustedInvocationContext(await options.memoryContext?.(verified, tool, signal));
            if (verified.generationId !== options.generationId ||
              ctx.principal.sub !== verified.principal.principalId || ctx.workspaceRef !== verified.workspace.workspaceId ||
              ctx.memory?.binding.active_generation !== verified.generationId ||
              ctx.memory.binding.policy_epoch !== verified.policyRevision ||
              ctx.correlationId !== verified.correlationId) throw new MemoryTrustedContextError('attachment binding mismatch');
            return ctx;
          },
        });
        const transport = options.createTransport();
        await server.connect(transport);
        return transport.handleRequest(c.req.raw);
      });
      return router;
    },
  };
}

/** Derive the runner identity from the verified context (never client headers). */
function identityFromVerified(verified: VerifiedInvocationContext): RequestIdentity {
  return {
    clientId: verified.principal.principalId,
    tenantRef: verified.workspace.workspaceId,
    scopes: [...verified.scopes],
    hasBearer: true,
  };
}

/** Derive the runner identity from a host-verified principal (never client headers). */
function toRequestIdentity(principal: McpPrincipal): RequestIdentity {
  return {
    clientId: principal.clientId,
    ...(principal.tid === null ? {} : { tenantRef: principal.tid }),
    scopes: [...principal.scopes],
    hasBearer: true,
  };
}

async function verifyMcpInvocation(
  context: VerifiedInvocationContextPort,
  generationId: string,
  c: {
    req: {
      method: string;
      path: string;
      header(name: string): string | undefined;
    };
  },
): Promise<VerifiedInvocationContext | null> {
  const invocationId = c.req.header('x-cluster-mesh-invocation-id') ?? randomUUID();
  const evidence = c.req.header('x-cluster-mesh-evidence');
  try {
    return await context.verify({
      invocationId,
      correlationId: c.req.header('x-correlation-id') ?? invocationId,
      generationId,
      method: c.req.method,
      path: c.req.path,
      ...(evidence === undefined ? {} : { authorizationEvidenceRef: evidence }),
    });
  } catch {
    return null;
  }
}
