// SQLite test fixture and shared-corpus client (lot 1).
// Temp-file databases under the OS temp dir: never inside worktrees or Git.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { backendScopeKey } from '../../src/storage/backend.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';
import { RootMutationCoordinator } from '../../src/storage/mutation-coordinator.js';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
import { createSqliteKernel, type SqliteKernel } from '../../src/storage/sqlite/index.js';
import { grantFor } from './authority-corpus.js';

// Test-only failure seams, mirroring staged-client.ts: one-shot refusals
// inside coordinator publication (before any effect lands) and after purge
// responses. Production handles stay untouched.
type FailurePoint = 'external' | 'purge-before' | 'purge-response';
const armed = new Map<string, Set<FailurePoint>>();
const arm = (scopeKey: string, point: FailurePoint): void => {
  const points = armed.get(scopeKey) ?? new Set<FailurePoint>();
  points.add(point);
  armed.set(scopeKey, points);
};
const consume = (scopeKey: string, point: FailurePoint): void => {
  if (armed.get(scopeKey)?.delete(point)) throw new StorageInvalidCommandError(`test ${point} interruption`);
};
let publishSpyInstalled = false;
const ensurePublishSpy = (): void => {
  if (publishSpyInstalled) return;
  publishSpyInstalled = true;
  const publish = RootMutationCoordinator.prototype.publish;
  vi.spyOn(RootMutationCoordinator.prototype, 'publish').mockImplementation(function (scope, base, prepared, revalidate) {
    const key = backendScopeKey(scope);
    consume(key, 'external');
    consume(key, 'purge-before');
    return publish.call(this, scope, base, prepared, revalidate);
  });
};

export interface SqliteFixture {
  readonly kernel: SqliteKernel;
  readonly dir: string;
  readonly path: string;
  grant(overrides?: Partial<ScopeGrant<unknown>>): ScopeGrant<unknown>;
  close(): void;
}

export const createSqliteFixture = (): SqliteFixture => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-sqlite-'));
  const path = join(dir, 'store.db');
  const kernel = createSqliteKernel({ path, moduleId: 'comments', cursorSecret: 'sqlite-lot1-secret' });
  return {
    kernel,
    dir,
    path,
    grant: (overrides = {}) => grantFor({ operations: ['read', 'write', 'maintain'], ...overrides }),
    close: (): void => {
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

type BeginStagedInput = Parameters<RootScopedRuntime['beginStaged']>[0];

export const sqliteCorpusClient = (kernel: SqliteKernel, grant: ScopeGrant<unknown>) => {
  ensurePublishSpy();
  const bound = kernel.bindNew(grant) as RootScopedRuntime;
  const fences = new Map<string, WriterFence>();
  const extra = {
    beginStaged: async (input: BeginStagedInput) => {
      kernel.provisionFence(grant.scope, grant.principalId, input.fence);
      const unit = await bound.beginStaged(input);
      fences.set(unit.unitId, input.fence);
      return unit;
    },
    sealStaged: async (input: { unit: AuthenticatedStagedHandle; root: StagedCommitRoot }) => {
      const fence = fences.get(input.unit.unitId)!;
      let outcome;
      do { outcome = await bound.sealStep({ ...input, fence }); } while (outcome.state === 'validating');
      return outcome.seal;
    },
    commitStaged: (input: { seal: AuthenticatedStagedSeal; fence: WriterFence }) => bound.commitStaged(input),
    abortStaged: (input: { unit: AuthenticatedStagedHandle; fence?: WriterFence; reason?: string }) =>
      bound.abortStaged({
        unit: input.unit,
        fence: input.fence ?? fences.get(input.unit.unitId)!,
        reason: input.reason ?? 'corpus cancellation',
      }),
    armExternalFailure: async () => {
      arm(backendScopeKey(bound.scope), 'external');
    },
    armPurgeFailure: async () => {
      arm(backendScopeKey(bound.scope), 'purge-before');
    },
    armPurgeResponseFailure: async () => {
      arm(backendScopeKey(bound.scope), 'purge-response');
    },
    completePurge: async (intentId: string) => {
      const outcome = await bound.completePurge(intentId);
      consume(backendScopeKey(bound.scope), 'purge-response');
      return outcome;
    },
  };
  return new Proxy(bound, {
    get(target, property) {
      if (Object.hasOwn(extra, property)) return extra[property as keyof typeof extra];
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(target) : value;
    },
  }) as RootScopedRuntime & typeof extra;
};
