/**
 * Lot 7 — typed optional stdio leaf for the same compiled plan
 * (`@sentropic/cluster-mesh/mcp/stdio`, spec-v8 §3).
 *
 * Same bridge, same kernel validation, same identity-chained guard as the
 * composed `/mcp` namespace; only the transport differs (SDK stdio).
 * stdio identity comes from the environment once at startup — there is no
 * bearer on stdio and no separate business registry or authority.
 */
import '../modules/topology-guard-mcp.js';
import type { Readable, Writable } from 'node:stream';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { createGuardedRunner, type McpInvocationGuard } from '../compose/mcp.js';
import { loadMcpPlatformBridge } from '../loaders/mcp/bridge.js';
import { loadMcpPlatformStdio } from '../loaders/mcp/stdio.js';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import type {
  BridgeRunner,
  BridgeTool,
  RequestIdentity,
} from '@sentropic/mcp-platform/transport/bridge';
import type { McpPrincipal } from '@sentropic/mcp-platform/hono';

export interface McpStdioLeafOptions {
  registry: CompiledMcpRegistry;
  tools: readonly BridgeTool[];
  runner: BridgeRunner;
  contextResolver(
    identity: RequestIdentity | undefined,
  ): McpPrincipal | Promise<McpPrincipal>;
  invocation: McpInvocationGuard;
  env?: Record<string, string | undefined>;
  stdin?: Readable;
  stdout?: Writable;
}

export interface McpStdioLeaf {
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Prepare the stdio leaf. Missing/incompatible platform leaves and bridge
 * tools outside the compiled plan fail startup before any I/O binds.
 */
export async function createMcpStdioLeaf(
  modules: ClusterMeshModules,
  options: McpStdioLeafOptions,
): Promise<McpStdioLeaf> {
  const [bridge, stdio] = await Promise.all([
    loadMcpPlatformBridge(modules),
    loadMcpPlatformStdio(modules),
  ]);
  for (const tool of options.tools) {
    if (options.registry.resolveTool(tool.name) === undefined) {
      throw new Error(`Bridge tool '${tool.name}' is not in the compiled plan`);
    }
  }
  const identity = stdio.extractStdioRequestIdentity(options.env ?? (process.env as Record<string, string | undefined>));
  const guardedRunner = createGuardedRunner(options);
  const server = new SdkServer(
    { name: '@sentropic/cluster-mesh/mcp', version: '0.18.0' },
    { capabilities: { tools: {} } },
  );
  bridge.registerBridgeTools(server, options.tools, {
    run: (tool, args) => guardedRunner.run(tool, args, identity),
  });
  const transport = new StdioServerTransport(
    options.stdin ?? process.stdin,
    options.stdout ?? process.stdout,
  );
  return {
    start: async () => {
      await server.connect(transport);
    },
    close: async () => {
      await transport.close();
      await server.close();
    },
  };
}
