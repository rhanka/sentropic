/**
 * Lot 5 — stdio bridge: same plan, same kernel validation, same wire codec
 * as the Streamable HTTP bridge (`registerBridgeTools` is shared, so wire
 * bytes are identical). Only the transport factory and the request-identity
 * source differ: stdio identity comes from the environment, never from a
 * bearer (there is none on stdio).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  registerBridgeTools,
  type BridgeRunner,
  type BridgeTool,
  type RequestIdentity,
} from './streamable-http.js';

export { registerBridgeTools, type BridgeRunner, type BridgeTool, type RequestIdentity };

/** Build the SDK stdio server transport (instantiation alone acquires no I/O). */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

/** Extract request identity from the process environment (no bearer on stdio). */
export function extractStdioRequestIdentity(
  env: Record<string, string | undefined>,
): RequestIdentity {
  const scopes = (env['MCP_SCOPES'] ?? '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const clientId = env['MCP_CLIENT_ID'];
  const tenantRef = env['MCP_TENANT_REF'];
  return {
    ...(clientId === undefined ? {} : { clientId }),
    ...(tenantRef === undefined ? {} : { tenantRef }),
    scopes,
    hasBearer: false,
  };
}
