import { describe, expect, it } from 'vitest';
import { computeMutationDigest, validateMutationPreimage, validatePolicyVersionsProjection } from '../../src/memory/mutation-guard.js';
import { canonicalJson } from '../../src/tool-configuration.js';
import { A05_MUTATION_DIGEST_VECTORS_SPEC_RULE as corpus } from '../../../../tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/memory-mcp-spec-rules.js';
const capture = () => JSON.parse(corpus.vectors.capture_v1.expected_jcs_utf8);

describe('P03.platform.a05-mutation-digest-vectors — identical frozen A05 corpus', () => {
  it.each(Object.entries(corpus.vectors))('seals %s to its committed digest and JCS bytes', (_name, vector) => {
    const input = JSON.parse(vector.expected_jcs_utf8);
    expect(validateMutationPreimage(input)).toEqual([]);
    expect(canonicalJson(input)).toBe(vector.expected_jcs_utf8);
    expect(computeMutationDigest(input)).toBe(vector.expected_digest);
    expect(computeMutationDigest(Object.fromEntries(Object.entries(input).reverse()) as any)).toBe(vector.expected_digest);
  });
  it.each([
    (p: any) => {
      const payload = p.effective_input.payload;
      payload.citations.push({ ...payload.citations[0], citation_id: 'cit_2' });
      payload.primary_event.citation_id = 'cit_2';
    },
    (p: any) => { p.effective_input.payload.reconciliation.family_refs = ['z', 'a']; },
    (p: any) => { p.effective_input.payload.reconciliation.family_refs = ['a', 'a']; },
    (p: any) => { p.effective_input.payload.reconciliation.family_refs = Array.from({ length: 65 }, (_, i) => `f${i.toString().padStart(2, '0')}`); },
    (p: any) => { p.effective_input.payload.components[0].citation_ids.push('cit_1'); },
    (p: any) => { p.effective_input.payload.derivation = { source_record_ids: ['z', 'a'], transform_ref: 't', transform_receipt_digest: `sha256:${'1'.repeat(64)}` }; },
    (p: any) => { p.effective_input.payload.valid_time.t = Number.MAX_SAFE_INTEGER + 1; },
    (p: any) => { p.effective_input.payload.valid_time.t_end = Number.MAX_SAFE_INTEGER + 1; },
    (p: any) => { p.effective_input.payload.primary_event.at = Number.MAX_SAFE_INTEGER + 1; },
    (p: any) => { p.effective_input.payload = { unexpected: true }; p.effective_input.evidence = {}; },
    (p: any) => { p.effective_input.payload.components[0].extra = true; },
    (p: any) => { p.effective_input.payload.citations[0].locator.extra = true; },
    (p: any) => { p.target.sequence = '18446744073709551616'; },
    (p: any) => { p.effective_input.payload.retention.expires_at = '2026-02-30T00:00:00.000Z'; },
    (p: any) => { p.effective_input.payload.components[0].text = 'e\u0301'; },
  ])('refuses invalid nested DTOs and primitive boundaries', mutate => {
    const input = capture(); mutate(input);
    expect(validateMutationPreimage(input).length).toBeGreaterThan(0);
    expect(() => computeMutationDigest(input)).toThrow();
  });
  it.each([42, 'x', '2026-02-30T00:00:00.000Z'])('refuses invalid lifecycle instant %s', occurred_at => {
    const input = JSON.parse(corpus.vectors.withdraw_v1.expected_jcs_utf8);
    input.effective_input.event_anchor.occurred_at = occurred_at;
    expect(validateMutationPreimage(input).length).toBeGreaterThan(0);
  });
  it('preserves opaque candidate bytes while rejecting non-record identifiers', () => {
    const candidate = JSON.parse(corpus.vectors.request_admission_v1.expected_jcs_utf8);
    candidate.target.candidate_id = candidate.effective_input.candidate_id = 'e\u0301';
    expect(validateMutationPreimage(candidate)).toEqual([]);
    const record = JSON.parse(corpus.vectors.forget_v1.expected_jcs_utf8);
    record.target.record_id = record.effective_input.record_id = 'arbitrary';
    expect(validateMutationPreimage(record).length).toBeGreaterThan(0);
  });
  it('rejects extra policy projection members', () => {
    const effective = capture().effective_input;
    expect(validatePolicyVersionsProjection(effective, { tool_name: effective.tool_name,
      capture_policy_version: effective.capture_policy_version, extra: true } as any).length).toBeGreaterThan(0);
  });
});
