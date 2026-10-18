/**
 * MCP-L5 Lot 1 — mutation guard tests.
 *
 * Case: P02.platform.mutation-guard. Covers the closed effective-input
 * arms, policy-version projection, principal-scoped same-key reuse and
 * cross-tool conflict, and version-omission refusal before hashing.
 */
import { describe, expect, it } from 'vitest';
import { A05_MUTATION_DIGEST_VECTORS_SPEC_RULE as corpus } from '../../../../tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/memory-mcp-spec-rules.js';
import {
  checkSameKeyBinding,
  computeMutationDigest,
  reservationLookupKey,
  validateEffectiveInput,
  validateMutationPreimage,
  validatePolicyVersionsProjection,
} from '../../src/memory/mutation-guard.js';
import type {
  EffectiveMemoryMutationInputV1,
  MemoryMutationPreimageV1,
} from '../../src/memory/contracts.js';

const CAPTURE_INPUT: EffectiveMemoryMutationInputV1 = {
  tool_name: 'engram_memory_capture',
  payload: { ...corpus.vectors.capture_v1.preimage.effective_input.payload, scope_ref: 'tenant-1' },
  evidence: corpus.vectors.capture_v1.preimage.effective_input.evidence,
  capture_policy_version: 'capture-policy/v1',
};

const ADMISSION_INPUT: EffectiveMemoryMutationInputV1 = {
  tool_name: 'engram_memory_request_admission',
  candidate_id: 'candidate-1',
  admission_policy_version: 'admission-policy/v1',
};

function makePreimage(overrides: Record<string, unknown> = {}): MemoryMutationPreimageV1 {
  return {
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
    tool_name: 'engram_memory_capture',
    idempotency_key: '0123456789abcdef',
    target: { kind: 'capture_source', source_ref: 'source-1', sequence: '7' },
    effective_input: CAPTURE_INPUT,
    ...overrides,
  } as MemoryMutationPreimageV1;
}

describe('P02.platform.mutation-guard', () => {
  it('P02.platform.mutation-guard: accepts the four closed effective-input arms', () => {
    expect(validateEffectiveInput(CAPTURE_INPUT)).toEqual([]);
    expect(validateEffectiveInput(ADMISSION_INPUT)).toEqual([]);
    expect(
      validateEffectiveInput({
        tool_name: 'engram_memory_withdraw',
        candidate_id: 'candidate-1',
        reason_ref: 'reason-1',
        event_id: 'event-1',
        event_anchor: {
          occurred_at: '2026-10-18T00:00:00.000Z',
          kind_ref: 'withdraw',
          provenance_ref: 'prov-1',
          provenance_digest: 'sha256:' + 'a'.repeat(64),
        },
      }),
    ).toEqual([]);
    expect(
      validateEffectiveInput({
        tool_name: 'engram_memory_forget',
        record_id: 'record-1',
        reason_ref: 'reason-1',
        event_id: 'event-1',
        event_anchor: {
          occurred_at: '2026-10-18T00:00:00.000Z',
          kind_ref: 'tombstone',
          provenance_ref: 'prov-1',
          provenance_digest: 'sha256:' + 'b'.repeat(64),
        },
      }),
    ).toEqual([]);
  });

  it('P02.platform.mutation-guard: refuses unknown members, nulls and impossible tool/target crosses', () => {
    expect(validateEffectiveInput({ ...CAPTURE_INPUT, extra: 1 }).length).toBeGreaterThan(0);
    expect(validateEffectiveInput({ ...CAPTURE_INPUT, payload: null }).length).toBeGreaterThan(0);
    expect(
      validateEffectiveInput({
        tool_name: 'engram_memory_request_admission',
        candidate_id: 'candidate-1',
      }).length,
    ).toBeGreaterThan(0);
    expect(validateEffectiveInput({ tool_name: 'nope' }).length).toBeGreaterThan(0);
    const crossed = makePreimage({
      tool_name: 'engram_memory_forget',
      target: { kind: 'candidate', candidate_id: 'candidate-1' },
      effective_input: {
        tool_name: 'engram_memory_forget',
        record_id: 'record-1',
        reason_ref: 'reason-1',
        event_id: 'event-1',
        event_anchor: {
          occurred_at: '2026-10-18T00:00:00.000Z',
          kind_ref: 'tombstone',
          provenance_ref: 'prov-1',
          provenance_digest: 'sha256:' + 'b'.repeat(64),
        },
      },
    });
    expect(validateMutationPreimage(crossed).join(' ')).toMatch(/impossible tool\/target/);
  });

  it('P02.platform.mutation-guard: refuses version omission before hashing', () => {
    const noVersion = makePreimage({
      effective_input: {
        tool_name: 'engram_memory_capture',
        payload: { schema_version: 1 },
        evidence: {},
      },
    });
    expect(validateMutationPreimage(noVersion).length).toBeGreaterThan(0);
    expect(() => computeMutationDigest(noVersion)).toThrow();
  });

  it('P02.platform.mutation-guard: seals a stable digest and reuses the same key', () => {
    const first = makePreimage();
    const second = makePreimage();
    const digest = computeMutationDigest(first);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeMutationDigest(second)).toBe(digest);
    expect(reservationLookupKey(first)).toEqual({
      principal_namespace: 'sentropic.principal',
      principal_id: 'user-1',
      tenant_id: 'tenant-1',
      store_id: 'ci-1',
      provider_id: 'sentropic.engram.memory',
      connector_id: 'engram-memory',
      connector_instance_ref: 'ci-1',
      scope_ref: 'tenant-1',
      idempotency_key: '0123456789abcdef',
    });
    const stored = {
      toolName: 'engram_memory_capture' as const,
      target: first.target,
      digest,
    };
    expect(checkSameKeyBinding(stored, { ...stored }).decision).toBe('reuse');
  });

  it('P02.platform.mutation-guard: conflicts on changed tool, target or digest under the same key', () => {
    const digest = computeMutationDigest(makePreimage());
    const stored = {
      toolName: 'engram_memory_capture' as const,
      target: makePreimage().target,
      digest,
    };
    expect(
      checkSameKeyBinding(stored, { ...stored, toolName: 'engram_memory_withdraw' }).decision,
    ).toBe('DIGEST_CONFLICT');
    expect(
      checkSameKeyBinding(stored, {
        ...stored,
        target: { kind: 'candidate', candidate_id: 'candidate-9' },
      }).decision,
    ).toBe('DIGEST_CONFLICT');
    expect(checkSameKeyBinding(stored, { ...stored, digest: `sha256:${'9'.repeat(64)}` }).decision).toBe(
      'DIGEST_CONFLICT',
    );
  });

  it('P02.platform.mutation-guard: validates the exact policy-version projection', () => {
    expect(
      validatePolicyVersionsProjection(CAPTURE_INPUT, {
        tool_name: 'engram_memory_capture',
        capture_policy_version: 'capture-policy/v1',
      }),
    ).toEqual([]);
    expect(
      validatePolicyVersionsProjection(CAPTURE_INPUT, {
        tool_name: 'engram_memory_capture',
        capture_policy_version: 'capture-policy/v2',
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePolicyVersionsProjection(
        { tool_name: 'engram_memory_withdraw' } as unknown as EffectiveMemoryMutationInputV1,
        { tool_name: 'engram_memory_withdraw' },
      ),
    ).toEqual([]);
    expect(
      validatePolicyVersionsProjection(
        { tool_name: 'engram_memory_withdraw' } as unknown as EffectiveMemoryMutationInputV1,
        { tool_name: 'engram_memory_withdraw', capture_policy_version: 'x' } as unknown as {
          tool_name: 'engram_memory_withdraw';
        },
      ).length,
    ).toBeGreaterThan(0);
  });
});
