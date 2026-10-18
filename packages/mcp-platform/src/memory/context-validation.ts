import { isValidCursor, isValidDigest, isValidIdempotencyKey, isValidInstant, isValidOpaqueRef, utf8ByteLength } from './contracts.js';
import type { DelegationBindingV1, MemoryInvocationBindingV1 } from './frozen-context.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Reflect.ownKeys(value).every(k => typeof k === 'string' && keys.includes(k));
}
export function validDelegation(value: DelegationBindingV1, now: string): boolean {
  return closed(value, ['delegator_principal_id', 'delegate_principal_id', 'delegation_receipt_digest', 'verified_by_host_resolver', 'expires_at']) &&
    isValidOpaqueRef(value.delegator_principal_id) && isValidOpaqueRef(value.delegate_principal_id) &&
    isValidDigest(value.delegation_receipt_digest) && value.verified_by_host_resolver === true &&
    isValidInstant(value.expires_at) && isValidInstant(now) && Date.parse(now) < Date.parse(value.expires_at);
}
const REF_FIELDS = ['issuer', 'sub', 'tid', 'principal_namespace', 'principal_id', 'tenant_id', 'agent_id',
  'mcp_client_id', 'logical_session_ref', 'transport_attachment_ref', 'connector_instance_ref', 'store_id',
  'scope_ref', 'purpose_ref', 'audit_id', 'correlation_ref', 'cancellation_ref'] as const;
const KEYS = [...REF_FIELDS, 'claims', 'claims_provenance_receipt', 'tenant_membership_receipt',
  'tenant_resolution_source', 'workspace_id', 'connection_proof_digest', 'publisher_id', 'provider_id',
  'connector_id', 'selected_source_id', 'active_generation', 'policy_epoch', 'deadline_at', 'issued_at',
  'channel_binding', 'transport_scopes', 'idempotency_key', 'elicitation_ref', 'delegation',
  'neutral_credential', 'neutral_context_ref'];

/** Validate the closed A03 record against independently supplied current host state. */
export function validateBinding(value: unknown, generation: string, epoch: string, now: string): string[] {
  if (!closed(value, KEYS)) return ['binding: expected closed host record'];
  const b = value as unknown as MemoryInvocationBindingV1;
  const failures: string[] = [];
  for (const key of REF_FIELDS) if (!isValidOpaqueRef(b[key])) failures.push(`binding.${key}: invalid reference`);
  for (const key of ['claims_provenance_receipt', 'tenant_membership_receipt', 'connection_proof_digest'] as const) {
    if (!isValidDigest(b[key])) failures.push(`binding.${key}: invalid receipt`);
  }
  if (!Array.isArray(b.claims) || !b.claims.includes('sub') || !b.claims.includes('tid') ||
      !b.claims.every(isValidOpaqueRef) || new Set(b.claims).size !== b.claims.length) failures.push('binding.claims: verified sub/tid required');
  if (b.tenant_resolution_source !== 'authoritative_membership' || b.tenant_id !== b.tid) failures.push('binding.tenant: authoritative membership required');
  if (b.workspace_id !== undefined && !isValidOpaqueRef(b.workspace_id)) failures.push('binding.workspace_id: invalid');
  if (b.publisher_id !== 'sentropic.engram.memory' || b.provider_id !== 'sentropic.engram.memory' ||
      b.connector_id !== 'engram-memory' || b.selected_source_id !== 'mcp:engram-memory') failures.push('binding.routing: invalid');
  if (!isValidCursor(generation) || !isValidCursor(b.active_generation) || b.active_generation !== generation) failures.push('binding.active_generation: stale');
  if (!isValidCursor(epoch) || !isValidCursor(b.policy_epoch) || b.policy_epoch !== epoch) failures.push('binding.policy_epoch: stale');
  if (typeof b.neutral_credential !== 'string' || b.neutral_credential.trim().length === 0 ||
      utf8ByteLength(b.neutral_credential) > 4096) failures.push('binding.neutral_credential: invalid');
  if (b.neutral_context_ref !== undefined && !isValidOpaqueRef(b.neutral_context_ref)) failures.push('binding.neutral_context_ref: invalid');
  if (b.idempotency_key !== undefined && !isValidIdempotencyKey(b.idempotency_key)) failures.push('binding.idempotency_key: invalid');
  if (b.elicitation_ref !== undefined && !isValidOpaqueRef(b.elicitation_ref)) failures.push('binding.elicitation_ref: invalid');
  if (!['in_process_verified', 'stdio_host_managed_verified', 'http_mcp_auth_dpop_verified', 'http_mcp_auth_bearer_verified'].includes(b.channel_binding) ||
      !Array.isArray(b.transport_scopes) || !b.transport_scopes.includes('mcp:tools:invoke') ||
      b.transport_scopes.some(s => !['mcp:discover', 'mcp:tools:invoke'].includes(s)) ||
      new Set(b.transport_scopes).size !== b.transport_scopes.length) failures.push('binding.channel: verified invocation channel required');
  if (![now, b.issued_at, b.deadline_at].every(isValidInstant) || Date.parse(now) < Date.parse(b.issued_at) ||
      Date.parse(now) >= Date.parse(b.deadline_at) || Date.parse(b.deadline_at) - Date.parse(b.issued_at) > 30000) failures.push('binding.lifecycle: invalid interval');
  if (b.delegation !== undefined && (!validDelegation(b.delegation, now) || b.delegation.delegate_principal_id !== b.principal_id)) failures.push('binding.delegation: invalid');
  if (b.audit_id === 'audit_mcp_l0_default') failures.push('binding.audit_id: synthetic');
  return failures;
}
