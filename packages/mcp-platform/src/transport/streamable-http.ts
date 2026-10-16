/**
 * Lot 5 — Streamable HTTP transport for the shared SDK bridge
 * (`./bridge.js`): `createStreamableHttpTransport` builds the SDK HTTP
 * transport; the host owns listening. Re-exports the shared bridge surface
 * so both transports consume one registration.
 */
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export {
  extractHttpRequestIdentity,
  identityFromExtra,
  registerBridgeTools,
  type BridgeOptions,
  type BridgeRunner,
  type BridgeTool,
  type RequestIdentity,
} from './bridge.js';

/** Build the SDK Streamable HTTP server transport (the host owns listening). */
export function createStreamableHttpTransport(
  options?: StreamableHTTPServerTransportOptions,
): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport(options);
}
