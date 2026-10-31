import type { MemoryEngineDependenciesV2, Digest } from '@sentropic/engram/memory-substrate';
import { receiptDigest } from '@sentropic/engram/mcp-memory';
export const D: Digest = `sha256:${'a'.repeat(64)}`;
export const NOW = '2026-10-29T18:00:00.000Z';
export const DEADLINE = '2026-10-29T18:00:30.000Z';
export const clock = { now: () => NOW };

/** Explicit test authorities; canonical persistence is the real PostgreSQL adapter. */
export function mcpDependencies(scope_ref: string): Omit<MemoryEngineDependenciesV2, 'canonical_store'> {
  const plaintext = new Map<string, string>();
  return {
    clock, activity_sources: [],
    authorization: {
      version: 1,
      authorize: async (request) => {
        const body = { allowed: true as const, decision_id: 'memory-test-decision', policy_version: '1',
          operation: request.operation, resource_digest: request.resource_digest, scope_ref,
          not_before: NOW, expires_at: DEADLINE, revocation_epoch: '0',
          redaction: { mode: 'field-allowlist' as const,
            allowed_fields: ['/authorization_receipt_digest', '/citations', '/components', '/payload_digest',
              '/primary_component_id', '/primary_event', '/purpose_ref', '/reconciliation', '/record_digest',
              '/record_id', '/recorded_at', '/recorded_cursor', '/retention', '/schema_version', '/scope_ref', '/trust', '/valid_time'],
            allow_derivation_lineage: false, max_packet_bytes: 1048576 }, authentication_receipt_digest: D };
        return { ok: true, value: { ...body, receipt_digest: receiptDigest('authorization-allowed', body) } };
      },
      revalidate: async (receipt_digest, checked_at) => {
        const body = { receipt_digest, checked_at, valid: true, current_revocation_epoch: '0', reason: 'valid' as const };
        return { ok: true, value: { ...body, revalidation_receipt_digest: receiptDigest('authorization-revalidation', body, 'revalidation_receipt_digest') } };
      },
      redact: async () => { throw new Error('engine applies the allowed field mask'); },
    },
    admission_policy: { policy_id: 'memory-test-policy', policy_version: '1', decide: async ({ record_digest }) => {
      const body = { policy_id: 'memory-test-policy', policy_version: '1', record_digest, decision: 'accept' as const, issued_at: NOW };
      return { ok: true, value: { ...body, receipt_digest: receiptDigest('admission-decision', body) } };
    } },
    crypto: {
      version: 1,
      seal: async ({ candidate_id, plaintext: bodyText }) => {
        plaintext.set(candidate_id, bodyText);
        const body = { candidate_id, envelope_ref: `envelope-${candidate_id}`, key_ref: `key-${candidate_id}`, ciphertext: `ciphertext-${candidate_id}` };
        return { ok: true, value: { ...body, envelope_digest: receiptDigest('sealed-candidate', body) } };
      },
      open: async ({ sealed }) => {
        const body = plaintext.get(sealed.candidate_id);
        return body === undefined ? { ok: false, error: { code: 'NOT_FOUND', operation: 'inspect_candidate', retryable: false, message: 'destroyed' } }
          : { ok: true, value: { plaintext: body } };
      },
      destroy: async ({ key_ref }) => {
        plaintext.delete(key_ref.slice(4));
        return { ok: true, value: { destroyed: true, receipt_digest: receiptDigest('key-destruction', { destroyed: true, key_ref }) } };
      },
      rotate: async () => { throw new Error('key rotation is outside this test fixture'); },
    },
    evidence_verifier: {
      verifier_id: 'memory-test-verifier', verifier_version: '1',
      classify: async ({ payload_digest }) => {
        const body = { class: 'earned' as const, evidence_digest: D, verifier_id: 'memory-test-verifier', verifier_version: '1', issued_at: NOW, revocation_epoch: '0' };
        return { ok: true, value: { ...body, receipt_digest: receiptDigest('earned-trust', { ...body, payload_digest }) } };
      },
      revalidate: async (binding_receipt_digest, checked_at) => {
        const body = { binding_receipt_digest, checked_at, valid: true, current_revocation_epoch: '0', reason: 'valid' as const };
        return { ok: true, value: { ...body, revalidation_receipt_digest: receiptDigest('trust-revalidation', body, 'revalidation_receipt_digest') } };
      },
    },
  };
}

export const captureInput = (idempotency_key: string) => ({ idempotency_key,
  payload: { schema_version: 2, purpose_ref: 'purpose-memory', valid_time: { t: 1 },
    components: [{ component_id: 'component-memory', kind: 'context', text: 'memory body', citation_ids: ['citation-memory'] }],
    primary_component_id: 'component-memory', primary_event: { at: 1, type_ref: 'event-memory', citation_id: 'citation-memory' },
    citations: [{ citation_id: 'citation-memory', source_ref: 'source-memory', locator: { scheme: 'document', value: 'memory#one' }, content_digest: D }] },
  evidence: { evidence_ref: 'evidence-memory', evidence_digest: D, citation_ids: ['citation-memory'] },
});
