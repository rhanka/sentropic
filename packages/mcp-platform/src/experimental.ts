/** @experimental — published but NOT frozen; no semver guarantee. */

/**
 * `@sentropic/mcp-platform/experimental` — the mutation / elicitation / durable /
 * store-port surface (SPEC_EVOL_MCP_PLATFORM_ACTIVATION §3.2). Real implementations,
 * but not consumer-proven, so this tier is EXEMPT from semver: hosts MUST NOT depend
 * on it in production. Consumer-proven pieces are promoted to the frozen root `.`
 * additively after openerp/Wave validation.
 */

// Mutation gate (R1a) — retyped against the local AuditSinkPort, not a mock.
export { assertMutationGate, invokeGuardedTool } from './experimental/mutation-gate.js';
export type {
  AuditSinkPort,
  MutationGateReason,
  MutationGateResult,
  GuardedInvokeDeps,
} from './experimental/mutation-gate.js';

// Provisional elicitation policy (F8) + experimental manifest extension (R1b).
export { elicitationPolicyIsSecretSafe } from './experimental/manifest-elicitation.js';
export type {
  ElicitationPolicyMode,
  ElicitationPolicy,
  AppMcpProviderManifestWithElicitation,
} from './experimental/manifest-elicitation.js';

// Elicitation state machine (OQ2) — security-load-bearing, store-injectable.
export { ElicitationManager } from './elicitation.js';
export type {
  ElicitationState,
  ElicitationMode,
  ElicitationRecord,
  Completer,
  DelegationResolver,
  CreateInput,
} from './elicitation.js';

// DurableCall mirror (OQ4) — Hermes-owned canonical shape, unpublished; kept
// experimental (never frozen) until Hermes publishes. `DurableCallRef` (the bare
// string alias) stays frozen on the root `.`.
export type {
  DurableCall,
  DurableCallKind,
  DurableCallState,
  McpDurableCall,
  McpDurableCallRefs,
  DurableCallWaitingFor,
} from './runtime.js';

// Opaque audit handle for caller-controlled idempotency keys (fix G4).
export { idempotencyDigest } from './digest.js';

// Store PORT interfaces — real seams a DB/KMS host satisfies; only the port is ever
// promoted toward frozen, never a persistent class (those live in `./testing`).
export type {
  SessionStore,
  ConsentStore,
  EnrollmentStore,
  SecretStatusStore,
  ElicitationStore,
  SecretKey,
} from './stores.js';
export type { RecordStore } from './persistence.js';
