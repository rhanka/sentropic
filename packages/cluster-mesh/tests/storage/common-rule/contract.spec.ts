// L01a structural tests: fixed common-rule vectors plus validator refusal
// cases. No backend, encoder, adapter or SQL asset is touched here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  hasCommonRight,
  validateCommonBoundedPage,
  validateCommonCapability,
  validateCommonManifestBody,
  validateCommonPublicationCondition,
} from '../../../src/storage/common-contract.js';
import { COMMON_RULE_ABOVE_SAFE_TERMINAL_COUNT, COMMON_RULE_VECTORS, COMMON_RULE_VECTORS_BY_ID } from './vectors.js';

const digestOf = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const validCondition = () => ({
  publicationId: 'pub-1',
  expectedPredecessor: null,
  scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  incarnation: 'store-1',
  fence: { fenceId: 'fence-1', epoch: '2' },
  operationId: 'op-1',
});
describe('L01a common-rule vectors', () => {
  it('should keep common v1 limited to its original modules on every surface', () => {
    const vector = COMMON_RULE_VECTORS_BY_ID['common-v1-transactional'];
    const body = JSON.parse(vector.canonicalBytes) as Record<string, unknown>;
    for (const surface of ['transactional', 'analytical', 'live-graph']) {
      for (const module of ['comments', 'engram-live']) {
        assert.deepEqual(validateCommonManifestBody({ ...body, module, surface }), { ok: true, errors: [] });
      }
      assert.deepEqual(validateCommonManifestBody({ ...body, module: 'engram-memory', surface }), {
        ok: false,
        errors: ['module must be a known storage module'],
      });
    }
  });

  it('should accept every frozen vector body as a valid manifest', () => {
    for (const vector of COMMON_RULE_VECTORS) {
      const body: unknown = JSON.parse(vector.canonicalBytes);
      assert.equal(validateCommonManifestBody(body).ok, true, `${vector.id} must validate`);
    }
  });

  it('should match the recorded digest for every frozen vector', () => {
    for (const vector of COMMON_RULE_VECTORS) {
      assert.equal(digestOf(vector.canonicalBytes), vector.sha256, `${vector.id} digest must match`);
    }
  });

  it('should change the digest when ordered units are permuted', () => {
    const v2 = COMMON_RULE_VECTORS_BY_ID['common-v2-analytical'];
    const v3 = COMMON_RULE_VECTORS_BY_ID['common-v3-units-swapped'];
    assert.notEqual(v2.sha256, v3.sha256, 'ordered-unit permutation must change the digest');
    assert.ok(v2.canonicalBytes.indexOf('"unit-a"') < v2.canonicalBytes.indexOf('"unit-b"'));
    assert.ok(v3.canonicalBytes.indexOf('"unit-b"') < v3.canonicalBytes.indexOf('"unit-a"'));
  });

  it('should refuse an unknown contract version before interpreting lists', () => {
    const v1 = COMMON_RULE_VECTORS_BY_ID['common-v1-transactional'];
    const body = { ...(JSON.parse(v1.canonicalBytes) as Record<string, unknown>), commonContract: '9' };
    const result = validateCommonManifestBody(body);
    assert.equal(result.ok, false);
    assert.ok(result.errors.join(' ').includes('unknown common-contract version'));
  });

  it('should refuse a terminal that does not close the inventory', () => {
    const v1 = COMMON_RULE_VECTORS_BY_ID['common-v1-transactional'];
    const parsed = JSON.parse(v1.canonicalBytes) as Record<string, unknown>;
    const wrongCount = { ...parsed, terminal: { count: '2', complete: true } };
    assert.equal(validateCommonManifestBody(wrongCount).ok, false);
    const incomplete = { ...parsed, terminal: { count: '1', complete: false } };
    assert.equal(validateCommonManifestBody(incomplete).ok, false);
  });

  it('should refuse an above-safe terminal count as a decimal counter', () => {
    const v1 = COMMON_RULE_VECTORS_BY_ID['common-v1-transactional'];
    const parsed = JSON.parse(v1.canonicalBytes) as Record<string, unknown>;
    const aboveSafe = { ...parsed, terminal: { count: COMMON_RULE_ABOVE_SAFE_TERMINAL_COUNT, complete: true } };
    assert.deepEqual(validateCommonManifestBody(aboveSafe), {
      ok: false,
      errors: ['terminal count must be a decimal counter'],
    });
  });

  it('should refuse a malformed object digest', () => {
    const v1 = COMMON_RULE_VECTORS_BY_ID['common-v1-transactional'];
    const parsed = JSON.parse(v1.canonicalBytes) as Record<string, unknown>;
    const objects = parsed['objects'] as Record<string, unknown>[];
    const malformed = { ...parsed, objects: [{ ...objects[0], sha256: 'not-a-digest' }] };
    assert.equal(validateCommonManifestBody(malformed).ok, false);
    // A well-formed but unrelated digest still passes structural validation:
    // digest-against-payload verification belongs to the backend lots, not L01a.
    const wellFormed = { ...parsed, objects: [{ ...objects[0], sha256: '0'.repeat(64) }] };
    assert.equal(validateCommonManifestBody(wellFormed).ok, true);
  });
});
describe('L01a common-rule conditions, pages and capabilities', () => {
  it('should accept a complete publication condition and refuse a missing fence', () => {
    assert.equal(validateCommonPublicationCondition(validCondition()).ok, true);
    const { fence: _dropped, ...withoutFence } = validCondition();
    assert.equal(validateCommonPublicationCondition(withoutFence).ok, false);
  });

  it('should accept a bounded page and refuse unbounded limits', () => {
    assert.equal(validateCommonBoundedPage({ maxItems: 50, maxEncodedBytes: 65536 }).ok, true);
    assert.equal(validateCommonBoundedPage({ maxItems: 0, maxEncodedBytes: 65536 }).ok, false);
    assert.equal(validateCommonBoundedPage({ maxItems: 50, maxEncodedBytes: 65536, continuation: 7 }).ok, false);
  });

  it('should grant only the explicitly listed rights', () => {
    const reader = {
      principal: 'reader-1',
      rights: ['read'],
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      policyRevision: 'pol-3',
    };
    assert.equal(validateCommonCapability(reader).ok, true);
    assert.equal(hasCommonRight({ ...reader, rights: ['read'] }, 'read'), true);
    assert.equal(hasCommonRight({ ...reader, rights: ['read'] }, 'publish'), false);
    assert.equal(validateCommonCapability({ ...reader, rights: [] }).ok, false);
    assert.equal(validateCommonCapability({ ...reader, rights: ['read', 'read'] }).ok, false);
    assert.equal(validateCommonCapability({ ...reader, rights: ['read', 'super'] }).ok, false);
  });
});
