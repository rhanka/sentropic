/**
 * L0 — effective-profile contract vectors (immo #861, ask 1 shape).
 *
 * Frozen selection and bounds vectors for the 0.2.0 profile declaration.
 * Pure unit vectors: no DB, no S3, no app.handle, no mocked provider.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_DERIVATION_CASE,
  CANONICAL_COMMAND_FIXTURES,
  COMMAND_IDENTITY_RELATIONS,
  DERIVATION_VECTORS,
  buildDerivationPreimage,
  canonicalizeJson,
  detectAmbiguousSplit,
  resolvePlatformEnvelope,
} from '../l0-freeze/command-identity-contract.js';
import {
  COMPOSITION_DIGEST_INPUTS,
  KNOWN_ARTIFACT_TOOL_NAMES,
  PROFILE_BOUNDS,
  PROFILE_CONTRACT_VERSION,
  PROFILE_RESERVED_FIRST_SEGMENTS,
  PROFILE_TEXT_MIME_TYPES,
  RADAR_INVOCATION_SCOPE,
  RADAR_OPERATION_ROUTES,
  RADAR_SELECTED_TOOL_NAMES,
  validateBindingName,
  validateCallerIdempotencyKey,
  validateListBounds,
  validatePublishFileCount,
  validateToolSelection,
} from '../l0-freeze/profile-contract.js';

describe('effective-profile contract', () => {
  it('should freeze the profile shape version', () => {
    expect(PROFILE_CONTRACT_VERSION).toBe('artifacts-profile/v1');
  });

  it('should know all fifteen existing tool names', () => {
    expect(KNOWN_ARTIFACT_TOOL_NAMES).toHaveLength(15);
    expect([...KNOWN_ARTIFACT_TOOL_NAMES]).toContain('artifacts_ensure');
    expect([...KNOWN_ARTIFACT_TOOL_NAMES]).toContain('artifacts_restore');
  });

  it('should select exactly the four Radar tools with the immo scope', () => {
    expect([...RADAR_SELECTED_TOOL_NAMES]).toEqual([
      'artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
    ]);
    expect(RADAR_INVOCATION_SCOPE).toBe('immo:read');
  });

  it('should accept the Radar selection and the empty selection', () => {
    expect(validateToolSelection({ tools: [...RADAR_SELECTED_TOOL_NAMES] })).toEqual([]);
    expect(validateToolSelection({ tools: [] })).toEqual([]);
  });

  it('should reject unknown and duplicate selection entries', () => {
    expect(validateToolSelection({ tools: ['artifacts_nope'] })).toHaveLength(1);
    expect(validateToolSelection({
      tools: ['artifacts_ensure', 'artifacts_ensure'],
    })).toHaveLength(1);
  });

  it('should bound binding names to 1-128 units without normalization', () => {
    expect(validateBindingName('a')).toBe(true);
    expect(validateBindingName('')).toBe(false);
    expect(validateBindingName('x'.repeat(128))).toBe(true);
    expect(validateBindingName('x'.repeat(129))).toBe(false);
  });

  it('should require nonempty trimmed caller keys within 256 units', () => {
    expect(validateCallerIdempotencyKey('key-1')).toBe(true);
    expect(validateCallerIdempotencyKey('   ')).toBe(false);
    expect(validateCallerIdempotencyKey('')).toBe(false);
    expect(validateCallerIdempotencyKey('x'.repeat(256))).toBe(true);
    expect(validateCallerIdempotencyKey('x'.repeat(257))).toBe(false);
    expect(validateCallerIdempotencyKey('  key-1  ')).toBe(true);
  });

  it('should reject lone surrogates before UTF-8 conversion', () => {
    const high = String.fromCharCode(0xd800);
    const low = String.fromCharCode(0xdc00);
    expect(validateCallerIdempotencyKey(high)).toBe(false);
    expect(validateCallerIdempotencyKey(low)).toBe(false);
    expect(validateCallerIdempotencyKey(`a${high}b`)).toBe(false);
    expect(validateCallerIdempotencyKey(`x${high}`)).toBe(false);
    expect(validateCallerIdempotencyKey(`${low}y`)).toBe(false);
  });

  it('should accept valid pairs, U+FFFD and astral boundaries unchanged', () => {
    const pair = String.fromCodePoint(0x10000);
    const replacement = String.fromCharCode(0xfffd);
    expect(validateCallerIdempotencyKey(pair)).toBe(true);
    expect(validateCallerIdempotencyKey(replacement)).toBe(true);
    expect(validateCallerIdempotencyKey(pair.repeat(128))).toBe(true);
    expect(validateCallerIdempotencyKey(pair.repeat(129))).toBe(false);
    expect(validateCallerIdempotencyKey(
      `${String.fromCharCode(0xe9, 0xe0, 0xfc)}-${String.fromCodePoint(0x1f3e0)}`,
    )).toBe(true);
  });

  it('should bound publish files to 1-32 entries', () => {
    expect(validatePublishFileCount(1)).toBe(true);
    expect(validatePublishFileCount(32)).toBe(true);
    expect(validatePublishFileCount(0)).toBe(false);
    expect(validatePublishFileCount(33)).toBe(false);
  });

  it('should freeze the decoded-byte and transport budgets', () => {
    expect(PROFILE_BOUNDS.maxDecodedFileBytes).toBe(262144);
    expect(PROFILE_BOUNDS.maxDecodedTotalBytes).toBe(262144);
    expect(PROFILE_BOUNDS.pathMaxBytes).toBe(1024);
    expect(PROFILE_BOUNDS.httpControlMaxEncodedBytes).toBe(2 * 1024 * 1024);
  });

  it('should freeze the MIME allowlist and reserved first segments', () => {
    expect([...PROFILE_TEXT_MIME_TYPES]).toEqual([
      'text/html', 'text/css', 'text/javascript', 'application/json',
    ]);
    expect([...PROFILE_RESERVED_FIRST_SEGMENTS]).toEqual([
      'api', '__artifacts', 'livez', 'health',
    ]);
  });

  it('should bound list pagination with documented defaults', () => {
    expect(validateListBounds(1, 0)).toBe(true);
    expect(validateListBounds(100, 5)).toBe(true);
    expect(validateListBounds(0, 0)).toBe(false);
    expect(validateListBounds(101, 0)).toBe(false);
    expect(validateListBounds(20, -1)).toBe(false);
    expect(PROFILE_BOUNDS.listLimitDefault).toBe(20);
    expect(PROFILE_BOUNDS.listOffsetDefault).toBe(0);
  });

  it('should include selection and profile in composition evidence', () => {
    expect([...COMPOSITION_DIGEST_INPUTS]).toEqual([
      'selection', 'profile', 'providerContractRevisions',
    ]);
  });

  it('should derive the documented internal key preimages and digests', () => {
    for (const vector of DERIVATION_VECTORS) {
      expect(buildDerivationPreimage(vector.binding)).toBe(vector.preimage);
      expect(createHash('sha256').update(vector.preimage, 'utf8').digest('hex'))
        .toBe(vector.sha256);
    }
  });

  it('should refuse ambiguous separator-bearing scope and actor splits', () => {
    const { first, second, expected } = AMBIGUOUS_DERIVATION_CASE;
    expect(buildDerivationPreimage(first)).toBe(buildDerivationPreimage(second));
    expect(detectAmbiguousSplit(first, second)).toBe(true);
    expect(expected).toBe('refuse');
    expect(detectAmbiguousSplit(
      { ...first, scope: 's', actor: 'alice' },
      { ...first, scope: 's', actor: 'issuer|alice' },
    )).toBe(false);
  });

  it('should bind the platform envelope to the tool argument', () => {
    expect(resolvePlatformEnvelope('key-1', undefined)).toBe('accept');
    expect(resolvePlatformEnvelope('key-1', 'key-1')).toBe('accept');
    expect(resolvePlatformEnvelope('key-1', 'key-2')).toBe('conflict');
    expect(resolvePlatformEnvelope(undefined, 'key-1')).toBe('envelope-only');
  });

  it('should declare the command-identity relations L1 must enforce', () => {
    expect(COMMAND_IDENTITY_RELATIONS.map((entry) => entry.expectation)).toEqual([
      'converge', 'conflict', 'computed-only',
    ]);
  });

  it('should encode golden effective commands with stable digests', () => {
    for (const fixture of CANONICAL_COMMAND_FIXTURES) {
      expect(canonicalizeJson(fixture.body)).toBe(fixture.canonical);
      expect(createHash('sha256').update(fixture.canonical, 'utf8').digest('hex'))
        .toBe(fixture.sha256);
    }
    const [baseline, shuffled, swapped, changedMime] = CANONICAL_COMMAND_FIXTURES;
    expect(shuffled.canonical).toBe(baseline.canonical);
    expect(shuffled.sha256).toBe(baseline.sha256);
    expect(swapped.sha256).not.toBe(baseline.sha256);
    expect(changedMime.sha256).not.toBe(baseline.sha256);
  });

  it('should never mutate the encoded command input', () => {
    const deepFreeze = (value: unknown): unknown => {
      if (value !== null && typeof value === 'object') {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
      return value;
    };
    const body = deepFreeze(structuredClone(CANONICAL_COMMAND_FIXTURES[0].body));
    expect(() => canonicalizeJson(body)).not.toThrow();
    expect(canonicalizeJson(body)).toBe(CANONICAL_COMMAND_FIXTURES[0].canonical);
  });

  it('should freeze the four C2 capability routes', () => {
    expect([...RADAR_OPERATION_ROUTES]).toEqual([
      { capability: 'artifacts_ensure', method: 'POST', path: '/ensure', command: 'ensure' },
      { capability: 'artifacts_publish', method: 'POST', path: '/publish', command: 'publish' },
      { capability: 'artifacts_list', method: 'POST', path: '/list', command: 'list' },
      { capability: 'artifacts_get', method: 'GET', path: '/meta/{artifactId}', command: 'meta' },
    ]);
  });
});
