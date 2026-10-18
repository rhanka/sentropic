/**
 * `@sentropic/mcp-broker` — plan-bound provider broker (public entry).
 *
 * Frozen root runtime exports: `McpProviderBroker`, `McpBrokerError`,
 * `UnknownConnectorError`, plus the `InvokeOptions` and `SecretResolver`
 * types. `InvokeOptions` requires a verified host invocation context; the
 * broker never manufactures identity. Memory contracts live under the pure
 * `./memory` entry; the reference store arrives under `./memory-reference`
 * in Lot 2. No testing export, no compatibility fallback.
 */
export {
  McpProviderBroker,
  McpBrokerError,
  UnknownConnectorError,
  type InvokeOptions,
} from './broker.js';
export type { SecretResolver } from './context.js';
