import '../../modules/topology-guard-mcp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireTrustedInvocationContext, type StpConnectorContext } from '@sentropic/mcp-platform/memory';
import type { McpWireBridgeOptions } from '@sentropic/mcp-platform/transport/bridge';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import type { ClusterMeshModules } from '../../modules/contracts.js';
import { loadMcpPlatformBridge } from '../../loaders/mcp/bridge.js';
import { loadMcpPlatformToolSchemas } from '../../loaders/mcp/tool-schemas.js';
import type { EngramMemoryBuiltin } from './memory.js';

export interface EngramMemoryTransportDefinition {
  /** Trusted host attachment resolver; model arguments confer no authority. */
  resolveContext(tool: string, args: unknown, signal: AbortSignal): StpConnectorContext | Promise<StpConnectorContext>;
  limits: McpWireBridgeOptions['limits'];
  formatFailure: McpWireBridgeOptions['formatFailure'];
}

/** Same native registration for host-owned stdio and HTTP transports. */
export async function registerEngramMemoryTools(server: Server, options: {
  modules: ClusterMeshModules;
  registry: CompiledMcpRegistry;
  builtin: EngramMemoryBuiltin;
  definition: EngramMemoryTransportDefinition;
}): Promise<void> {
  const runtime = options.builtin.runtime();
  if (!runtime) throw new Error('memory MCP builtin has not been selected and compiled');
  const tools = (await runtime.server.listTools()).tools as Tool[];
  for (const tool of tools) {
    const selected = options.registry.resolveTool(tool.name);
    if (selected?.providerId !== options.builtin.providerId || JSON.stringify(selected.inputSchema) !== JSON.stringify(tool.inputSchema)) {
      throw new Error('memory MCP tool differs from the compiled plan');
    }
  }
  const bridge = await loadMcpPlatformBridge(options.modules);
  const schemas = await loadMcpPlatformToolSchemas(options.modules);
  const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
  bridge.registerMcpWireTools(server, tools, {
    run: async (tool, args, { signal }) => {
      let ctx: StpConnectorContext;
      try { ctx = requireTrustedInvocationContext(await options.definition.resolveContext(tool, args, signal)); }
      catch { throw new McpError(-32603, 'Trusted invocation context unavailable'); }
      try {
        return await runtime.server.callTool(tool, args, ctx, {
          idempotencyKey: ctx.memory?.binding.idempotency_key,
          elicitationRef: ctx.memory?.binding.elicitation_ref,
        }, signal);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === -32603) {
          throw new McpError(-32603, 'Trusted invocation context unavailable');
        }
        throw error;
      }
    },
  }, { ...options.definition, schemas: schemas.compileMcpToolSchemas(tools, options.definition.limits) });
}
