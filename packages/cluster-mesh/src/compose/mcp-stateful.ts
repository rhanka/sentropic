import '../modules/topology-guard-mcp.js';
import { authorizeDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import { loadMcpPlatformBridge } from '../loaders/mcp/bridge.js';
import { loadMcpPlatformToolSchemas } from '../loaders/mcp/tool-schemas.js';
import { loadMcpPlatformResultCodec } from '../loaders/mcp/result-codec.js';
import { createStatefulAuthority, combineMcpSignals } from '../mcp/stateful-context.js';
import { prepareStatefulTools } from '../mcp/stateful-preflight.js';
import type { McpWrapRefusal, StatefulMcpNamespaceOptions, VerifiedMcpRequest } from '../mcp/stateful-contracts.js';

export type {
  McpWrapRefusal, StatefulMcpHost, StatefulMcpHooks, StatefulMcpNamespaceOptions, VerifiedMcpRequest,
} from '../mcp/stateful-contracts.js';
export type { McpToolValidationLimits } from '@sentropic/mcp-platform/transport/tool-schemas';

const boundHosts = new WeakSet<object>();
const safeFailure = (): CallToolResult =>
  ({ content: [{ type: 'text', text: 'Tool call failed' }], isError: true });

/** Wrap public SDK dispatch while the existing host retains its complete HTTP lifecycle. */
export async function createStatefulMcpNamespace(
  modules: ClusterMeshModules, options: StatefulMcpNamespaceOptions,
): Promise<ClusterMeshHonoNamespaceModule> {
  const { tools, registry, claimNames } = prepareStatefulTools(options);
  if (boundHosts.has(options.host)) throw new TypeError('MCP host is already bound');
  const [bridge, validators, codec] = await Promise.all([
    loadMcpPlatformBridge(modules), loadMcpPlatformToolSchemas(modules), loadMcpPlatformResultCodec(modules),
  ]);
  const limits = Object.freeze({ ...options.limits });
  const schemas = validators.compileMcpToolSchemas(tools, limits);
  const authority = createStatefulAuthority(claimNames);
  const invoke = options.invoke;
  const authorize = options.authorize;
  const formatRefusal = options.formatRefusal;
  let active = false;
  const refusal = (tool: string, reason: McpWrapRefusal, context = authority.current()): CallToolResult => {
    if (!context) return safeFailure();
    try {
      const result = codec.validateMcpWireResult(formatRefusal(tool, reason, context), limits);
      if (result.isError !== true) throw new TypeError();
      return result;
    } catch { return safeFailure(); }
  };
  const runner = {
    async run(tool: string, args: Record<string, unknown>, extra: Readonly<{ signal: AbortSignal }>) {
      const current = authority.current();
      if (!active || !current) return refusal(tool, { kind: 'inactive' });
      const context: VerifiedMcpRequest = Object.freeze({
        ...current, signal: combineMcpSignals([current.signal, extra.signal]),
      });
      if (context.signal.aborted) return refusal(tool, { kind: 'inactive' }, context);
      const decision = authorizeDispatch({
        registry, toolName: tool,
        principal: { sub: context.principal.sub, clientId: context.principal.clientId ?? '',
          scopes: [...context.principal.scopes], claims: [...context.principal.claims] },
      });
      if (!decision.allowed) {
        const reason: McpWrapRefusal = decision.code === 'insufficient_scope'
          ? { kind: 'scope', missingScopes: registry.resolveTool(tool)!.requiredScopes.filter(
            scope => !context.principal.scopes.includes(scope)) }
          : { kind: 'policy' };
        return refusal(tool, reason, context);
      }
      let allowed = false;
      try { allowed = await authorize(tool, context); } catch { /* Account lookup fails closed. */ }
      if (allowed !== true) return refusal(tool, { kind: 'account' }, context);
      context.signal.throwIfAborted();
      const result = await invoke(tool, args, context);
      context.signal.throwIfAborted();
      return result;
    },
  };
  // Recheck after asynchronous leaf acquisition: concurrent composition must bind once.
  if (boundHosts.has(options.host)) throw new TypeError('MCP host is already bound');
  boundHosts.add(options.host);
  try {
    const router = await options.host.bind(Object.freeze({
      maxRequestBytes: limits.maxRequestBytes,
      run: authority.run,
      register: (server: Parameters<typeof bridge.registerMcpWireTools>[0]) => {
        bridge.registerMcpWireTools(server, tools, runner, {
          schemas, limits, formatFailure: (tool, failure) => refusal(tool, { kind: failure.kind }),
        });
      },
    }));
    if (!router || typeof router.fetch !== 'function') throw new TypeError('MCP host bind must return its complete router');
    active = true;
    return { namespace: '/mcp', enabled: true, createRouter: () => router };
  } catch (error) {
    active = false;
    throw error;
  }
}
