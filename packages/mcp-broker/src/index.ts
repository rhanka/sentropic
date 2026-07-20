/**
 * BR-72 DEPTH Lot 2 — `@sentropic/mcp-broker` public entry (private, not
 * published). See `./broker.ts`, `./registry.ts`, `./context.ts` and the
 * package `README.md` for the full proof scope.
 */
export { ConnectorRegistry, DuplicateConnectorError } from './registry.js';
export {
  createInMemoryContext,
  type InMemoryContextOptions,
  type SecretResolver,
} from './context.js';
export {
  McpProviderBroker,
  McpBrokerError,
  UnknownConnectorError,
  type InvokeOptions,
} from './broker.js';
