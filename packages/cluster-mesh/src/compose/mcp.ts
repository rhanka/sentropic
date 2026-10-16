/**
 * Lot 7 — mesh composition over the compiled plan
 * (`@sentropic/cluster-mesh/compose/mcp`, spec-v8 §3).
 *
 * Preflights the platform leaves (bridge + hono mount) before anything
 * binds, checks bridge/plan coherence (every bridge tool resolves by exact
 * name in the compiled registry), then serves `/mcp` through the shared
 * bridge. Authorization chains per call: boundary identity → host
 * `contextResolver` → host `invocation` guard → host `runner`. A refusal
 * stops before any tool effect. The classic `/invoke` path routes through
 * the same chain with no boundary identity.
 */
import '../modules/topology-guard-mcp.js';
import type { Hono } from 'hono';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
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
  stateful?: boolean;
}

type GuardedRun = (
  tool: string,
  args: Parameters<BridgeRunner['run']>[1],
  identity: RequestIdentity | undefined,
) => Promise<AppToolResult>;

async function guarded(
  options: McpNamespaceOptions,
  tool: string,
  args: Parameters<BridgeRunner['run']>[1],
  identity: RequestIdentity | undefined,
): Promise<AppToolResult> {
  const principal = await options.contextResolver(identity);
  const decision = await options.invocation.authorize({ operation: 'invoke', principal, tool });
  if (!decision.allowed) {
    return {
      ok: false,
      auditId: 'namespace-guard',
      redactionClass: 'low',
      error: { code: 'invocation_refused', message: decision.reason, retriable: false },
    };
  }
  return options.runner.run(tool, args, identity);
}

function refused(code: string, message: string): AppToolResult {
  return {
    ok: false,
    auditId: 'namespace-guard',
    redactionClass: 'low',
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
  for (const tool of options.tools) {
    const resolution: CompiledToolResolution | undefined = options.registry.resolveTool(tool.name);
    if (resolution === undefined) {
      throw new Error(`Bridge tool '${tool.name}' is not in the compiled plan`);
    }
  }
  const guardedRun: GuardedRun = (tool, args, identity) => guarded(options, tool, args, identity);
  const server = new SdkServer(
    { name: '@sentropic/cluster-mesh/mcp', version: '0.18.0' },
    { capabilities: { tools: {} } },
  );
  bridge.registerBridgeTools(server, options.tools, { run: guardedRun });
  return {
    namespace: '/mcp',
    enabled: true,
    createRouter: (): Hono =>
      hono.createMcpPlatformHono({
        auth: options.auth,
        connector: {
          invoke: async (request: McpInvocation) => {
            if (options.registry.resolveTool(request.capabilityRef) === undefined) {
              return refused('unknown_tool', `Unknown tool '${request.capabilityRef}'`);
            }
            return guardedRun(
              request.capabilityRef,
              request.input as Parameters<BridgeRunner['run']>[1],
              undefined,
            );
          },
          readResource: async () =>
            refused('unsupported_operation', 'Resource reads are not served by this namespace'),
        },
        mcp: {
          server,
          createTransport: options.createTransport,
          ...(options.stateful === true ? { stateful: true as const } : {}),
        },
      }),
  };
}
