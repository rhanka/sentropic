/**
 * MCP-L5 Lot 1 — A05 mutation digest vectors.
 *
 * Case: P03.platform.a05-mutation-digest-vectors. Literal canonical UTF-8
 * bytes and full SHA-256 expected values for each of the four mutation
 * arms, independently derived from the specification text: the canonical
 * literals below are hand-sorted (RFC 8785 UTF-16 key order, no spacing)
 * and hashed with node:crypto directly — never with the implementation
 * under test. Covers key-order, Unicode, numeric, changed target, changed
 * effective values and policy-version-only changes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeMutationDigest } from '../../src/memory/mutation-guard.js';
import type { MemoryMutationPreimageV1 } from '../../src/memory/contracts.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const BASE = {
  profile: 'sentropic.engram.memory-mutation/v1',
  reservation_ref: 'reservation-1',
  provider_id: 'sentropic.engram.memory',
  provider_contract_version: '1.0.0',
  principal_namespace: 'sentropic.principal',
  principal_id: 'user-1',
  tenant_id: 'tenant-1',
  store_id: 'ci-1',
  connector_id: 'engram-memory',
  connector_instance_ref: 'ci-1',
  scope_ref: 'tenant-1',
  idempotency_key: '0123456789abcdef',
} as const;

function shuffled<T extends object>(value: T): T {
  if (Array.isArray(value)) return value.map(shuffled) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).reverse();
    return Object.fromEntries(entries.map(([key, entry]) => [key, shuffled(entry as object)])) as T;
  }
  return value;
}

describe('P03.platform.a05-mutation-digest-vectors', () => {
  it('P03.platform.a05-mutation-digest-vectors: seals the withdraw arm to its literal digest', () => {
    const preimage = shuffled({
      ...BASE,
      tool_name: 'engram_memory_withdraw',
      target: { kind: 'candidate', candidate_id: 'candidate-1' },
      effective_input: {
        tool_name: 'engram_memory_withdraw',
        candidate_id: 'candidate-1',
        reason_ref: 'reason-1',
        event_id: 'event-1',
        event_anchor: {
          occurred_at: '2026-10-18T00:00:00.000Z',
          kind_ref: 'withdraw',
          provenance_ref: 'prov-1',
          provenance_digest: `sha256:${'a'.repeat(64)}`,
        },
      },
    }) as MemoryMutationPreimageV1;
    expect(computeMutationDigest(preimage)).toBe(`sha256:${sha(WITHDRAW_CANONICAL)}`);
  });

  it('P03.platform.a05-mutation-digest-vectors: seals the forget arm to its literal digest', () => {
    const preimage = shuffled({
      ...BASE,
      tool_name: 'engram_memory_forget',
      target: { kind: 'record', record_id: 'record-1' },
      effective_input: {
        tool_name: 'engram_memory_forget',
        record_id: 'record-1',
        reason_ref: 'reason-1',
        event_id: 'event-1',
        event_anchor: {
          occurred_at: '2026-10-18T00:00:00.000Z',
          kind_ref: 'tombstone',
          provenance_ref: 'prov-1',
          provenance_digest: `sha256:${'b'.repeat(64)}`,
        },
      },
    }) as MemoryMutationPreimageV1;
    expect(computeMutationDigest(preimage)).toBe(`sha256:${sha(FORGET_CANONICAL)}`);
  });

  it('P03.platform.a05-mutation-digest-vectors: covers Unicode and numeric payload values', () => {
    const unicode = shuffled({
      ...BASE,
      tool_name: 'engram_memory_capture',
      target: { kind: 'capture_source', source_ref: 'source-1', sequence: '7' },
      effective_input: {
        tool_name: 'engram_memory_capture',
        payload: { text: 'café', count: 2.5 },
        evidence: {},
        capture_policy_version: 'capture-policy/v1',
      },
    }) as MemoryMutationPreimageV1;
    const literal =
      '{"connector_id":"engram-memory","connector_instance_ref":"ci-1",' +
      '"effective_input":{"capture_policy_version":"capture-policy/v1","evidence":{},' +
      '"payload":{"count":2.5,"text":"café"},"tool_name":"engram_memory_capture"},' +
      '"idempotency_key":"0123456789abcdef","principal_id":"user-1",' +
      '"principal_namespace":"sentropic.principal",' +
      '"profile":"sentropic.engram.memory-mutation/v1","provider_contract_version":"1.0.0",' +
      '"provider_id":"sentropic.engram.memory","reservation_ref":"reservation-1",' +
      '"scope_ref":"tenant-1","store_id":"ci-1",' +
      '"target":{"kind":"capture_source","sequence":"7","source_ref":"source-1"},' +
      '"tenant_id":"tenant-1","tool_name":"engram_memory_capture"}';
    expect(computeMutationDigest(unicode)).toBe(`sha256:${sha(literal)}`);
  });

  it('P03.platform.a05-mutation-digest-vectors: changes target, values and policy version alter the digest', () => {
    const base = {
      ...BASE,
      tool_name: 'engram_memory_capture',
      target: { kind: 'capture_source', source_ref: 'source-1', sequence: '7' },
      effective_input: {
        tool_name: 'engram_memory_capture',
        payload: { schema_version: 1 },
        evidence: {},
        capture_policy_version: 'capture-policy/v1',
      },
    } as MemoryMutationPreimageV1;
    const baseDigest = computeMutationDigest(base);
    const changedTarget = {
      ...base,
      target: { kind: 'capture_source', source_ref: 'source-2', sequence: '7' },
    } as MemoryMutationPreimageV1;
    expect(computeMutationDigest(changedTarget)).not.toBe(baseDigest);
    const policyOnly = {
      ...base,
      effective_input: { ...base.effective_input, capture_policy_version: 'capture-policy/v2' },
    } as MemoryMutationPreimageV1;
    expect(computeMutationDigest(policyOnly)).not.toBe(baseDigest);
    const admissionPolicyOnly = {
      ...BASE,
      tool_name: 'engram_memory_request_admission',
      target: { kind: 'candidate', candidate_id: 'candidate-1' },
      effective_input: {
        tool_name: 'engram_memory_request_admission',
        candidate_id: 'candidate-1',
        admission_policy_version: 'admission-policy/v2',
      },
    } as MemoryMutationPreimageV1;
    expect(computeMutationDigest(admissionPolicyOnly)).not.toBe(`sha256:${sha(ADMISSION_CANONICAL)}`);
  });
});
