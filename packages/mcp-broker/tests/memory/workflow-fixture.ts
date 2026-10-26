import type { MemoryMutationPreimageV1 } from '@sentropic/mcp-platform/memory';
import { computeMutationDigest } from '@sentropic/mcp-platform/memory';
export function workflowInput(overrides: Partial<MemoryMutationPreimageV1> = {}) {
  const preimage: MemoryMutationPreimageV1 = {
    profile: 'sentropic.engram.memory-mutation/v1', reservation_ref: 'reservation-1',
    provider_id: 'sentropic.engram.memory', provider_contract_version: '1.0.0',
    principal_namespace: 'sentropic.principal', principal_id: 'human-1', tenant_id: 'tenant-1',
    store_id: 'canonical-pg', connector_id: 'engram-memory', connector_instance_ref: 'instance-1',
    scope_ref: 'workspace-distinct-from-tenant', tool_name: 'engram_memory_request_admission',
    idempotency_key: '0123456789abcdef', target: { kind: 'candidate', candidate_id: 'candidate-1' },
    effective_input: { tool_name: 'engram_memory_request_admission', candidate_id: 'candidate-1', admission_policy_version: 'v1' },
    ...overrides,
  };
  return { preimage, digest: computeMutationDigest(preimage),
    policyVersions: { tool_name: 'engram_memory_request_admission' as const, admission_policy_version: 'v1' },
    resolved: { retention: 'original', consent: 'consent-1', source: 'source-1', event: 'event-1', provenance: 'anchor-1' },
    audit: { auditId: 'audit-1', correlationId: 'correlation-1' } };
}
