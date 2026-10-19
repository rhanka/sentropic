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
    ['valid_time', 't', 'sha256:03ed6636f722480c343773e969c7f342a9cc3df54e291201224f3ff00fa85a4a'],
    ['primary_event', 'at', 'sha256:092917b2c23dec31b34d6fa7840fa913481d1d1e13469c3066129da1cb192431'],
    ['valid_time', 't_end', undefined],
  ] as const)('should reject raw JSON negative zero at payload.%s.%s before sealing', (object, field, expectedDigest) => {
    const input = capture();
    if (field === 't_end') input.effective_input.payload.valid_time.t = -1;
    input.effective_input.payload[object][field] = 0;
    const raw = JSON.stringify(input);
    const negative = JSON.parse(raw.replace(`"${field}":0`, `"${field}":-0`));
    expect(Object.is(negative.effective_input.payload[object][field], -0)).toBe(true);
    expect(validateMutationPreimage(negative)).toContain(`effective_input.payload.${object}.${field}: finite safe integer required`);
    expect(() => computeMutationDigest(negative)).toThrow('MemoryMutationPreimageV1 invalid');
    const positive = JSON.parse(raw);
    expect(Object.is(positive.effective_input.payload[object][field], 0)).toBe(true);
    expect(validateMutationPreimage(positive)).toEqual([]);
    const digest = computeMutationDigest(positive);
    if (expectedDigest) expect(digest).toBe(expectedDigest);
    else expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
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
    (p: any) => { p.effective_input.payload.purpose_ref = 'e\u0301'; },
    (p: any) => { p.effective_input.payload.citations[0].source_ref = 'e\u0301'; },
  ])('refuses invalid nested DTOs and primitive boundaries', mutate => {
    const input = capture(); mutate(input);
    expect(validateMutationPreimage(input).length).toBeGreaterThan(0);
    expect(() => computeMutationDigest(input)).toThrow();
  });
  it.each(['text', 'scheme', 'value'])('preserves non-NFC %s body bytes when sealing', field => {
    const input = capture(), payload = input.effective_input.payload;
    const body = field === 'text' ? payload.components[0] : payload.citations[0].locator;
    body[field] = 'e\u0301';
    expect(validateMutationPreimage(input)).toEqual([]);
    expect(canonicalJson(input)).toContain('e\u0301');
    const digest = computeMutationDigest(input);
    body[field] = 'é';
    expect(computeMutationDigest(input)).not.toBe(digest);
  });
  it.each(['text', 'scheme', 'value'])('enforces %s well-formedness and UTF-8 byte bounds', field => {
    for (const value of ['\ud800', 'é'.repeat(field === 'text' ? 32769 : 257)]) {
      const input = capture(), payload = input.effective_input.payload;
      (field === 'text' ? payload.components[0] : payload.citations[0].locator)[field] = value;
      expect(validateMutationPreimage(input).length).toBeGreaterThan(0);
      expect(() => computeMutationDigest(input)).toThrow();
    }
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
