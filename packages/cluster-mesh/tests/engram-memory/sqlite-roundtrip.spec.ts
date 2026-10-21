// memory aggregate round-trip on the installed generic SQLite kernel,
// on a disposable temp path: governed writes persist across close/reopen,
// and a conflicting higher-version write is refused against real stored
// state through the module's current-state resolver. This is functional
// composition evidence on throwaway storage: NOT a qualified provider
// composition, NOT durable profiles, NOT an S0 receipt.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScopeGrant } from '../../src/storage/authority.js';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import { createSqliteKernel, type SqliteKernel } from '../../src/storage/sqlite/index.js';
import {
  resolveMemoryCurrentFromAggregates,
  validateMemoryEffects,
} from '../../src/engram-memory/postgres.js';

const CAPTURE_KEY = JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']);

const creation = () => ({
  candidateId: 'candidate-1',
  revision: 1,
  recordDigest: null,
  createdCursor: '0',
  proof: { intent: 'capture' },
});

const updateFor = (key: string, version: number, value: unknown) => ({
  key,
  version,
  value: { format: 'utf8', data: JSON.stringify(value) },
});

const emptyUnit = () => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const grantFor = (): ScopeGrant<unknown> => ({
  token: 'memory-roundtrip-token',
  moduleId: 'engram-memory',
  scope: { tenantId: 'tenant-rt', workspaceId: 'workspace-rt' },
  principalId: 'principal-rt',
  operations: ['read', 'write', 'maintain'],
  issuer: 'roundtrip-host',
  authorityRevision: '1',
  policyRevision: '1',
  moduleAuthority: null,
  lifetime: { kind: 'invocation', invocationId: 'invocation-rt' },
});

const openKernel = (dir: string): SqliteKernel =>
  createSqliteKernel({ path: join(dir, 'memory.db'), moduleId: 'engram-memory', cursorSecret: 'roundtrip-secret' });

describe('memory SQLite round-trip on the installed kernel', () => {
  it('should persist governed capture bytes across close and reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-engram-memory-rt-'));
    const kernel = openKernel(dir);
    try {
      const bound = kernel.bindNew(grantFor()) as RootScopedRuntime;
      // Live backend reader: every validation rereads the kernel, never a cache.
      let backendReads = 0;
      const resolveCurrent = resolveMemoryCurrentFromAggregates(async (key: string) => {
        backendReads += 1;
        const found = await bound.readAggregate(key);
        if (found === null) return null;
        return { value: found.value } as never;
      });
      const unit = { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 1, creation())] };
      await validateMemoryEffects(unit as never, resolveCurrent);
      // The governed path reread the live backend, it did not assume absence.
      expect(backendReads).toBe(1);
      await bound.transact({}, async (tx) => {
        await tx.apply(unit as never);
      });
      const stored = await bound.readAggregate(CAPTURE_KEY);
      expect(stored?.version).toBe(1);
      expect(JSON.parse((stored?.value as { data: string }).data)).toEqual(creation());
      kernel.close();
      const reopened = openKernel(dir);
      try {
        const rebound = reopened.bindNew(grantFor()) as RootScopedRuntime;
        const reread = await rebound.readAggregate(CAPTURE_KEY);
        expect(reread?.version).toBe(1);
        expect(JSON.parse((reread?.value as { data: string }).data)).toEqual(creation());
      } finally {
        reopened.close();
      }
    } finally {
      try {
        kernel.close();
      } catch {
        // already closed for the reopen leg
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should refuse a conflicting higher-version write against real stored state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-engram-memory-rt-'));
    const kernel = openKernel(dir);
    try {
      const bound = kernel.bindNew(grantFor()) as RootScopedRuntime;
      const completed = { ...creation(), revision: 2, recordDigest: 'sha256:abc' };
      // Live backend reader: every validation rereads the kernel, never a
      // cache, so the refusal below is proven against the completed value at
      // the backend transaction boundary, not a first-read snapshot.
      let backendReads = 0;
      const resolveCurrent = resolveMemoryCurrentFromAggregates(async (key: string) => {
        backendReads += 1;
        const found = await bound.readAggregate(key);
        if (found === null) return null;
        return { value: found.value } as never;
      });
      await validateMemoryEffects({ ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 1, creation())] }, resolveCurrent);
      await bound.transact({}, async (tx) => {
        await tx.apply({ ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 1, creation())] } as never);
      });
      await validateMemoryEffects(
        { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 2, completed)] },
        resolveCurrent,
      );
      await bound.transact({}, async (tx) => {
        await tx.apply({ ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 2, completed)] } as never);
      });
      // Identical replay of the completed value is accepted: the resolver
      // tracks live backend state, not a stale first read.
      await validateMemoryEffects(
        { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 2, completed)] },
        resolveCurrent,
      );
      await expect(
        validateMemoryEffects(
          {
            ...emptyUnit(),
            updates: [
              updateFor(CAPTURE_KEY, 99, {
                ...creation(),
                revision: 99,
                recordDigest: 'sha256:changed',
                createdCursor: '999',
                proof: { changed: true },
              }),
            ],
          },
          resolveCurrent,
        ),
      ).rejects.toThrow(/immutable/);
      // Every validation above performed a live backend read: creation,
      // completion, replay, and the refused mutation.
      expect(backendReads).toBe(4);
      const unchanged = await bound.readAggregate(CAPTURE_KEY);
      expect(unchanged?.version).toBe(2);
      expect(JSON.parse((unchanged?.value as { data: string }).data)).toEqual(completed);
    } finally {
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
