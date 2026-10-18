import { describe, expect, it } from 'vitest';
import { computeMutationDigest, validateMutationPreimage } from '../../src/memory/mutation-guard.js';
import { canonicalJson } from '../../src/tool-configuration.js';
import { A05_MUTATION_DIGEST_VECTORS_SPEC_RULE as corpus } from '../../../../tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/memory-mcp-spec-rules.js';
const capture = () => JSON.parse(corpus.vectors.capture_v1.expected_jcs_utf8);

describe('identical frozen A05 corpus', () => {
  it.each(Object.entries(corpus.vectors))('seals %s to its committed digest and JCS bytes', (_name, vector) => {
    const input = JSON.parse(vector.expected_jcs_utf8);
    expect(validateMutationPreimage(input)).toEqual([]);
    expect(canonicalJson(input)).toBe(vector.expected_jcs_utf8);
    expect(computeMutationDigest(input)).toBe(vector.expected_digest);
    expect(computeMutationDigest(Object.fromEntries(Object.entries(input).reverse()) as any)).toBe(vector.expected_digest);
  });
  it.each([
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
});
