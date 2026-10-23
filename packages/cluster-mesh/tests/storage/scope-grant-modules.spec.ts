import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { canOperate, validateScopeGrant, type ScopeGrant } from '../../src/storage/authority.js';
import { isStorageModuleId, type StorageModuleId } from '../../src/storage/contracts.js';

const grant = (moduleId: StorageModuleId): ScopeGrant<unknown> => ({
  token: 'grant-1',
  moduleId,
  scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  principalId: 'principal-1',
  operations: ['read', 'write'],
  issuer: 'host-1',
  authorityRevision: '1',
  policyRevision: '1',
  moduleAuthority: {},
  lifetime: { kind: 'invocation', invocationId: 'invocation-1' },
});

describe('generic scope grant module admission', () => {
  for (const moduleId of ['comments', 'engram-memory'] as const) {
    it(`should accept ${moduleId} registration and its read/write grant`, () => {
      assert.equal(isStorageModuleId(moduleId), true);
      const candidate = grant(moduleId);
      assert.deepEqual(validateScopeGrant(candidate, { expectedModuleId: moduleId }), { ok: true, errors: [] });
      assert.equal(canOperate(candidate, 'read'), true);
      assert.equal(canOperate(candidate, 'write'), true);
      assert.equal(canOperate(candidate, 'maintain'), false);
    });
  }

  it('should preserve Comments grant refusals and their exact errors', () => {
    const candidate = grant('comments');
    const refusals = [
      [{ ...candidate, moduleId: 'unknown' }, 'grant requires a known module'],
      [{ ...candidate, token: '' }, 'grant requires a token'],
      [{ ...candidate, operations: [] }, 'grant requires at least one operation'],
      [{ ...candidate, operations: ['unknown'] }, 'grant carries an unknown operation'],
      [{ ...candidate, authorityRevision: '-1' }, 'grant requires a decimal authorityRevision'],
    ] as const;
    for (const [invalid, error] of refusals) {
      assert.deepEqual(validateScopeGrant(invalid), { ok: false, errors: [error] });
    }
    assert.deepEqual(validateScopeGrant(candidate, { expectedModuleId: 'engram-memory' }), {
      ok: false, errors: ['grant module mismatch'],
    });
  });
});
