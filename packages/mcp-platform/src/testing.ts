/** @internal — test harness/fixtures; not a production contract. */

/**
 * `@sentropic/mcp-platform/testing` — mocks / fixtures / reference implementations
 * a real host replaces (SPEC_EVOL_MCP_PLATFORM_ACTIVATION §3.3). Published so
 * consumers can exercise the contract, but EXEMPT from semver and NOT a production
 * contract: a real host supplies its own OIDC issuer, transport, audit sink, secret
 * store and durable-call backend.
 */

// Mock OIDC issuer (§6, §11).
export { MockOidcIssuer } from './mock/oidc.js';
export type {
  MockTokenClaims,
  IssueOptions,
  VerifyOptions,
  VerifyResult,
  VerifyFailure,
} from './mock/oidc.js';

// Mock MCP transport (§9 ref, §11).
export { InMemoryMcpServer, InMemoryMcpClient } from './mock/mcp-transport.js';
export type {
  McpRequest,
  SanitizedMcpRequest,
  McpResponse,
  McpRequestHandler,
  TokenAuthorizer,
} from './mock/mcp-transport.js';

// App-neutral fake connector fixture (+ slice-7 long-running tool).
export { createFakeConnector, fakeManifest } from './mock/fake-connector.js';
export type { FakeConnectorDeps } from './mock/fake-connector.js';

// Audit sink + redaction (§5, §6).
export { InMemoryAuditSink, SecretRedactor, REDACTION_TOKEN } from './audit.js';
export type { AuditEvent } from './audit.js';

// Audited context + secret store (§4.5, §6.4).
export { createStpConnectorContext, MockSecretStore, SecretAccessError } from './context.js';
export type { ContextDeps } from './context.js';

// Per-request authz middleware + record-backed resolvers (§6, §7.1, §11).
export {
  authorizeRequest,
  resolveAuthorizedTenant,
  InMemoryTenantRegistry,
  InMemoryConsentRegistry,
} from './authz.js';
export type {
  AuthzResult,
  AuthzRequest,
  AuthzDenyReason,
  AuthorizeDeps,
  TenantResolver,
  ConsentResolver,
} from './authz.js';

// Restart-safe mock persistence primitive (§6.3/§6.4/§5.1, §11).
export { MemoryRecordStore, FileRecordStore } from './persistence.js';

// Typed, restart-safe reference stores for §6.3 / §6.4 / §5.1 records (§11 probes).
export {
  PersistentSessionStore,
  PersistentConsentStore,
  PersistentEnrollmentStore,
  PersistentSecretStatusStore,
  PersistentElicitationStore,
  secretKeyOf,
} from './stores.js';

// Mock durable-call / workflow adapter for long-running MCP tools (§8, §11).
export { DurableCallAdapter, PersistentDurableCallStore } from './durable.js';
export type {
  DurableCallStore,
  DurableCallAdapterDeps,
  DurableLaunchInput,
  IdempotencyScope,
} from './durable.js';
