/**
 * L0 — effective-profile contract vectors (immo #861, ask 1 shape only).
 *
 * Frozen selection and bounds vectors for the 0.2.0 profile declaration.
 * Pure unit vectors: no DB, no S3, no app.handle, no mocked provider.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_DIGEST_INPUTS,
  KNOWN_ARTIFACT_TOOL_NAMES,
  PROFILE_BOUNDS,
  PROFILE_CONTRACT_VERSION,
  PROFILE_RESERVED_FIRST_SEGMENTS,
  PROFILE_TEXT_MIME_TYPES,
  RADAR_INVOCATION_SCOPE,
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
});
