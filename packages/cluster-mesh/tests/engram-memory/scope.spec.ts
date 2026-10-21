// G1c grant/key scope checks (C7 liaison pending G1d/S0): one
// tenant/workspace pair per store, grant module and operation binding,
// lexical keys scoped before bounds, and tombstone reads treated as absent.
// The authoritative candidate-to-scope liaison is not established here.

import { describe, expect, it } from 'vitest';
import { validateScopeGrant } from '../../src/storage/authority.js';
import {
  isMemoryLexicalTombstone,
  memoryJournalChain,
  memoryLexicalKey,
  memoryLexicalTombstone,
  memoryStoreMetaKey,
} from '../../src/engram-memory/codec.js';

const grant = (overrides: Record<string, unknown> = {}) => ({
  token: 'token-1',
  moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
  principalId: 'principal-1',
  operations: ['read', 'write'],
  issuer: 'issuer-1',
  authorityRevision: '1',
  policyRevision: '1',
  moduleAuthority: {},
  lifetime: { kind: 'invocation', invocationId: 'invocation-1' },
  ...overrides,
});

describe('memory scope binding', () => {
  it('should require the memory module with read and write operations', () => {
    expect(validateScopeGrant(grant()).ok).toBe(true);
    expect(validateScopeGrant(grant({ moduleId: 'comments' })).ok).toBe(true);
    expect(validateScopeGrant(grant({ operations: [] })).ok).toBe(false);
    expect(validateScopeGrant(grant({ scope: { tenantId: '', workspaceId: 'w' } })).ok).toBe(false);
  });

  it('should scope lexical keys before candidate limits', () => {
    expect(memoryLexicalKey('scope-ref-1', 'record-1')).toBe(
      JSON.stringify(['memory-lexical-v1', 'scope-ref-1', 'record-1']),
    );
    expect(memoryLexicalKey('scope-a', 'r')).not.toBe(memoryLexicalKey('scope-b', 'r'));
  });

  it('should treat tombstones as absent and pin the journal identity', () => {
    expect(isMemoryLexicalTombstone(memoryLexicalTombstone())).toBe(true);
    expect(isMemoryLexicalTombstone({ format: 'utf8', data: '{}' })).toBe(false);
    expect(memoryJournalChain()).toBe('memory-journal');
    expect(memoryStoreMetaKey()).toBe(JSON.stringify(['memory-store-meta-v1', 'binding']));
  });
});
