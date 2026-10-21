// memory aggregate round-trip on the installed generic SQLite kernel, on a
// disposable temp path: mandatory validation and effects share one backend
// transaction per write (sequential validation against fresh stored
// state), so a second completion validated after the first commits
// rereads committed state and is refused. This is NOT concurrent-writer
// serializability proof, NOT a qualified provider composition, NOT
// durable profiles, NOT S0.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScopeGrant } from '../../src/storage/root-facade.js';
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
      // Mandatory validation and effects share one backend transaction.
      await bound.transact({}, async (tx) => {
        const resolveCurrent = resolveMemoryCurrentFromAggregates(async (key: string) => {
          const found = await tx.readAggregate(key);
          if (found === null) return null;
          return { value: found.value } as never;
        });
        const unit = { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 1, creation())] };
        await validateMemoryEffects(unit as never, resolveCurrent);
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

  it('should refuse a second completion validated after the first commits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-engram-memory-rt-'));
    const kernel = openKernel(dir);
    // Controlled schedule mirroring the R3 probe: validate+apply the first
    // completion, then validate the second one. The second validation
    // rereads committed state inside its own transaction and is refused,
    // so it can never reach effects.
    const applyGoverned = async (
      bound: RootScopedRuntime,
      key: string,
      version: number,
      value: unknown,
    ): Promise<void> => {
      await bound.transact({}, async (tx) => {
        const resolveCurrent = resolveMemoryCurrentFromAggregates(async (currentKey: string) => {
          const found = await tx.readAggregate(currentKey);
          if (found === null) return null;
          return { value: found.value } as never;
        });
        const unit = { ...emptyUnit(), updates: [updateFor(key, version, value)] };
        await validateMemoryEffects(unit as never, resolveCurrent);
        await tx.apply(unit as never);
      });
    };
    try {
      const bound = kernel.bindNew(grantFor()) as RootScopedRuntime;
      const completedA = { ...creation(), revision: 2, recordDigest: 'sha256:first' };
      const completedB = { ...creation(), revision: 3, recordDigest: 'sha256:second' };
      await applyGoverned(bound, CAPTURE_KEY, 1, creation());
      await applyGoverned(bound, CAPTURE_KEY, 2, completedA);
      // Identical replay of the committed completion is accepted (read-only
      // check, no transaction needed). This positive control alone does not
      // establish which state was consulted: replay is also valid against a
      // stale or absent read. Liveness rests on the refusal reason below.
      await validateMemoryEffects(
        { ...emptyUnit(), updates: [updateFor(CAPTURE_KEY, 2, completedA)] },
        resolveMemoryCurrentFromAggregates(async (currentKey: string) => {
          const found = await bound.readAggregate(currentKey);
          if (found === null) return null;
          return { value: found.value } as never;
        }),
      );
      // The refusal reason proves live consultation: against the committed
      // rev2 the validator reports the completed proof immutable, whereas a
      // stale rev1 read would report the revision-advance rule and an absent
      // read would refuse as a non-1 creation revision. The second
      // transaction therefore reread committed state before its own effects.
      await expect(applyGoverned(bound, CAPTURE_KEY, 3, completedB)).rejects.toThrow(
        /completed capture proof is immutable/,
      );
      const unchanged = await bound.readAggregate(CAPTURE_KEY);
      expect(unchanged?.version).toBe(2);
      expect(JSON.parse((unchanged?.value as { data: string }).data)).toEqual(completedA);
    } finally {
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
