import { createHash } from 'node:crypto';
import { createMemoryPortV2, type CryptoPort, type Digest, type MemoryEngineDependenciesV2 } from '@sentropic/engram/memory-substrate';
import { canonicalizeMemoryJcs } from '../../src/engram-memory/codec.js';
import { bindHostCandidateScope, type HostInvocation } from './host-scope-binding.js';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { createMemoryHostLedger } from '../../src/engram-memory/ledger.js';
import { proveForRecoveryAuthorized, verifyHostBinding } from '../../src/engram-memory/binding.js';

export const NOW = '2026-10-27T00:00:00.000Z';
export const DEADLINE = '2026-10-27T01:00:00.000Z';
export const DIGEST = `sha256:${'a'.repeat(64)}` as Digest;
export const hostReceiptDigest = (kind: string, value: Record<string, unknown>, field = 'receipt_digest'): Digest => {
  const body = { ...value }; delete body[field];
  return `sha256:${createHash('sha256').update(`graphify-memory/${kind}/v1\0`).update(canonicalizeMemoryJcs(body)).digest('hex')}`;
};
export const memoryEngine = (host: MemoryCampaignHost, decision: 'accept' | 'reject' = 'accept') => {
  const scopeRef = 'memory-stage-b-scope';
  const original: HostInvocation = Object.freeze({ invocationId: 'inv-host-1', storeId: host.scopeBinding.store_id, scopeRef });
  let invocation: HostInvocation | null = original;
  const plaintext = new Map<string, string>();
  let destroyed = 0;
  const crypto: CryptoPort = {
    version: 1,
    seal: async (input) => {
      plaintext.set(input.candidate_id, input.plaintext);
      const body = { candidate_id: input.candidate_id, envelope_ref: `envelope-${input.candidate_id}`,
        key_ref: `key-${input.candidate_id}`, ciphertext: `ciphertext-${input.candidate_id}` };
      const sealed = { ...body, envelope_digest: hostReceiptDigest('sealed-candidate', body) };
      await host.ledger.record({ candidateId: input.candidate_id, storeId: original.storeId, scope: host.scopeBinding.scope,
        invocationId: original.invocationId, hostPrincipal: host.binding.memoryGrant.principalId, continuationIds: [],
        envelopeDigest: sealed.envelope_digest, state: 'reserved', receipt: null, cursor: null });
      return { ok: true, value: sealed };
    },
    open: async ({ sealed }) => {
      const value = plaintext.get(sealed.candidate_id);
      return value === undefined ? { ok: false, error: { code: 'UNAUTHORIZED', operation: 'inspect_candidate', retryable: false, message: 'key destroyed' } }
        : { ok: true, value: { plaintext: value } };
    },
    destroy: async ({ key_ref }) => {
      plaintext.delete(key_ref.slice(4)); destroyed++;
      return { ok: true, value: { destroyed: true, receipt_digest: hostReceiptDigest('key-destruction', { destroyed: true, key_ref }) } };
    },
  };
  const liaison = bindHostCandidateScope({ store: host.store, crypto, binding: host.scopeBinding, currentInvocation: () => invocation });
  const admission = liaison.store.applyAdmission!.bind(liaison.store);
  liaison.store.applyAdmission = async (input) => {
    const result = await admission(input);
    if (result.ok) await host.ledger.markTerminal(input.candidate_id, result.value, result.value.cursor);
    return result;
  };
  const pending = liaison.store.readPending!.bind(liaison.store);
  liaison.store.readPending = async (input) => {
    const result = await pending(input);
    if (result.ok || result.error.code !== 'UNAUTHORIZED' || invocation !== original) return result;
    // A fresh authenticated host invocation may recover only retained terminal
    // proofs. An empty ledger and copied invocation fields still refuse.
    await verifyHostBinding(host.kernel, host.binding, host.scopeBinding.scope);
    await host.handle.checkFence(host.binding.memoryGrant, host.fence);
    const retained = await host.ledger.read(input.candidate_id);
    if (!retained || retained.hostPrincipal !== host.binding.memoryGrant.principalId
      || retained.storeId !== original.storeId || retained.invocationId !== original.invocationId) return result;
    const restored = createMemoryHostLedger(); restored.restore([retained]);
    const proof = proveForRecoveryAuthorized(restored, host.binding, input.candidate_id, host.scopeBinding.scope);
    if (proof.state !== 'terminal') return result;
    return { ok: false, error: { code: 'NOT_FOUND', operation: 'request_admission', retryable: false,
      message: 'authorized terminal recovery has no pending envelope' } };
  };
  const dependencies = {
    canonical_store: liaison.store, crypto: liaison.crypto, activity_sources: [], clock: { now: () => NOW },
    authorization: {
      version: 1,
      authorize: async (request: { operation: string; resource_digest: Digest }) => {
        const body = { allowed: true, decision_id: 'decision-memory', policy_version: '1', operation: request.operation,
          resource_digest: request.resource_digest, scope_ref: scopeRef, not_before: NOW, expires_at: DEADLINE, revocation_epoch: '0',
          redaction: { mode: 'field-allowlist', allowed_fields: [], allow_derivation_lineage: false, max_packet_bytes: 4096 },
          authentication_receipt_digest: DIGEST };
        return { ok: true, value: { ...body, receipt_digest: hostReceiptDigest('authorization-allowed', body) } };
      },
      revalidate: async (receipt_digest: Digest, checked_at: string) => {
        const body = { receipt_digest, checked_at, valid: true, current_revocation_epoch: '0', reason: 'valid' };
        return { ok: true, value: { ...body, revalidation_receipt_digest: hostReceiptDigest('authorization-revalidation', body, 'revalidation_receipt_digest') } };
      },
      redact: async () => { throw new Error('unused redaction'); },
    },
    admission_policy: { policy_id: 'policy-memory', policy_version: '1', decide: async ({ record_digest }: { record_digest: Digest }) => {
      const body = { policy_id: 'policy-memory', policy_version: '1', record_digest, decision, issued_at: NOW };
      return { ok: true, value: { ...body, receipt_digest: hostReceiptDigest('admission-decision', body) } };
    } },
  } as unknown as MemoryEngineDependenciesV2;
  return { engine: createMemoryPortV2(dependencies), original, crypto: liaison.crypto,
    get destroyed() { return destroyed; }, get plaintextCount() { return plaintext.size; },
    enter: (next: HostInvocation | null) => { invocation = next; },
  };
};
export const memoryCaptureRequest = (sequence = '1', scope_ref = 'memory-stage-b-scope') => ({
  schema_version: 2 as const, idempotency_key: `stage-b-idempotency-${sequence}`,
  payload: { schema_version: 2 as const, scope_ref, purpose_ref: 'purpose-memory', valid_time: { t: 1 },
    components: [{ component_id: 'component-memory', kind: 'context' as const, text: `memory body ${sequence}`, citation_ids: ['citation-memory'] }],
    primary_component_id: 'component-memory', primary_event: { at: 1, type_ref: 'event-memory', citation_id: 'citation-memory' },
    citations: [{ citation_id: 'citation-memory', source_ref: 'source-memory', locator: { scheme: 'document', value: 'memory#one' }, content_digest: DIGEST }],
    retention: { derivative_rule: 'retain' as const }, reconciliation: { family_refs: [] } },
  evidence: { evidence_ref: 'evidence-memory', evidence_digest: DIGEST, citation_ids: ['citation-memory'] },
  authorization: { credential: 'credential-memory' }, source_order: { source_ref: 'source-memory', sequence },
  deadline_at: DEADLINE, cancellation_ref: `cancel-${sequence}`,
});
