// G1c grant/key scope checks plus the E8 host-private liaison: one
// tenant/workspace pair per store, grant module and operation binding,
// lexical keys scoped before bounds, and tombstone reads treated as absent.
// Producer co-review and E7 durable integration remain separate gates.

import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createMemoryPortV2, openModuleStorageCanonicalMemoryStoreV1,
  type CryptoPort, type MemoryEngineDependenciesV2 } from '@sentropic/engram/memory-substrate';
import { bindHostCandidateScope } from './host-scope-binding.js';
import { g1Clock, g1Deadline, g1Grant, g1HostHandle, g1ScopeBinding, G1_STORE_ID } from './g1-host.js';
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
  it('should compile the host fixture against the installed frozen DTOs', () => {
    const fixture = fileURLToPath(new URL('./host-scope-binding.ts', import.meta.url));
    const program = ts.createProgram([fixture], { strict: true, noEmit: true, types: [],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });

  it('should retain the installed constructor provenance when composing candidate guards', async () => {
    const transact = vi.fn();
    const opened = await openModuleStorageCanonicalMemoryStoreV1({
      handle: { ...g1HostHandle(), acquireFence: async () => ({ fenceId: 'e8-fence', epoch: '1' }),
        checkFence: async () => undefined, releaseFence: async () => undefined,
        readAggregate: async () => null, transact,
        query: async (name) => ({ format: 'utf8', data: JSON.stringify(name === 'scope-chain-index'
          ? { chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' } : []) }),
      }, scope_binding: g1ScopeBinding(), grant: g1Grant(), clock: g1Clock(), deadline_at: g1Deadline(),
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    const invocation = Object.freeze({ invocationId: 'e8-invocation', storeId: G1_STORE_ID, scopeRef: G1_STORE_ID });
    const composed = bindHostCandidateScope({ store: opened.value, crypto: {} as CryptoPort,
      binding: g1ScopeBinding(), currentInvocation: () => invocation });
    // Invalid input deliberately stops after the engine's genuine provenance gate.
    const port = createMemoryPortV2({ canonical_store: composed.store, clock: g1Clock() } as MemoryEngineDependenciesV2);
    const result = await port.capture({} as Parameters<typeof port.capture>[0]);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SCHEMA' } });
    expect(transact).not.toHaveBeenCalled();
    await opened.value.close();
  });

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
