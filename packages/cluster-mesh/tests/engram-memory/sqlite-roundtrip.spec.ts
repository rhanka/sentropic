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
      const unit = { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 1, creation())] };
      await validateMemoryEffects(unit as never);
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
      const stored = new Map<string, unknown>();
      const resolveCurrent = resolveMemoryCurrentFromAggregates(async (key: string) => {
        if (stored.has(key)) return { value: { format: 'utf8', data: JSON.stringify(stored.get(key)) } } as never;
        const found = await bound.readAggregate(key);
        if (found === null) return null;
        stored.set(key, JSON.parse((found.value as { data: string }).data));
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
      const unchanged = await bound.readAggregate(CAPTURE_KEY);
      expect(unchanged?.version).toBe(2);
      expect(JSON.parse((unchanged?.value as { data: string }).data)).toEqual(completed);
    } finally {
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
