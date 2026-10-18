import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { authorizeDispatch } from '@sentropic/mcp-platform/transport/dispatch';
import type { AppToolResult } from '@sentropic/mcp-platform/transport/bridge';
import type { McpOAuthNamespaceOptions } from './oauth-contracts.js';
import { combineOAuthSignals, oauthAuthority } from './oauth-context.js';
import type { createOAuthEgress } from './oauth-egress.js';
import type { compileOAuthToolSchemas } from './oauth-tool-schemas.js';

function refused(code: string): AppToolResult {
  return { ok: false, auditId: 'mcp-oauth', redactionClass: 'low',
    error: { code, message: code, retriable: false } };
}

/** Real platform bridge and result codec, with request authority and live account authorization. */
export async function connectOAuthServer(
  options: McpOAuthNamespaceOptions,
  bridge: typeof import('@sentropic/mcp-platform/transport/bridge'),
  egress: ReturnType<typeof createOAuthEgress>,
  validation: ReturnType<typeof compileOAuthToolSchemas>,
) {
  const server = new Server({ name: '@sentropic/cluster-mesh/mcp-oauth', version: '0.20.0' },
    { capabilities: { tools: {} } });
  // The bridge intentionally ignores transport identity hints. Wrap its SDK handlers to
  // combine SDK cancellation with this HTTP request, without changing the bridge contract.
  const register = server.setRequestHandler.bind(server);
  server.setRequestHandler = (schema, handler) => register(schema, (request, extra) => {
    const authority = oauthAuthority.getStore();
    if (!authority) throw new Error('MCP request authority unavailable');
    return oauthAuthority.run(Object.freeze({ ...authority,
      signal: combineOAuthSignals([authority.signal, extra.signal]),
    }), () => handler(request, extra));
  });
  bridge.registerBridgeTools(server, validation.bridgeTools, {
    async run(tool, args) {
      const authority = oauthAuthority.getStore();
      if (!authority || authority.signal.aborted) return refused('invocation_inactive');
      const argumentsResult = validation.validate(tool, args);
      if (!argumentsResult.valid) return refused('invalid_parameters');
      const { principal } = authority;
      const policy = authorizeDispatch({ registry: options.registry, toolName: tool, principal: {
        sub: principal.sub, clientId: principal.clientId ?? '', scopes: [...principal.scopes], claims: [],
      } });
      if (!policy.allowed) return refused(policy.code);
      try {
        const account = await options.resolveAccount(principal);
        if (account?.allowed !== true) return refused('account_denied');
      } catch {
        return refused('account_unavailable');
      }
      if (authority.signal.aborted) return refused('invocation_inactive');
      const bound = egress.bind(authority, tool);
      try {
        const result = await options.invoke(tool, argumentsResult.data, Object.freeze({
          principal, correlationId: authority.correlationId, egress: bound.capability,
        }));
        return authority.signal.aborted ? refused('invocation_inactive') : result;
      } catch {
        // The shared bridge otherwise serializes thrown messages; never expose host/issuer details.
        return refused('invocation_failed');
      } finally {
        bound.release();
      }
    },
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: validation.list() }));
  const transport = options.sessions.createTransport();
  try {
    await server.connect(transport);
  } catch {
    await server.close().catch(() => undefined);
    throw new Error('MCP transport unavailable');
  }
  return { transport, close: () => server.close() };
}
