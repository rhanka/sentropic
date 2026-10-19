// @sentropic/cluster-mesh/storage/sqlite — durable node:sqlite backend.
// Lot 1 boundary: committed ordinary state persists per mutation in one
// SQLite transaction that re-verifies ownership before COMMIT. Staged
// attachment, journal lanes, consumers and grant issuance stay
// session-local: reopening replays ordinary reads and commits, while
// staged-family calls on a reloaded populated scope refuse loudly until
// restart recovery lands. No Python, no addon, no helper binary.

import { createHash } from 'node:crypto';
import type { ScopeGrant } from '../authority.js';
import type { StorageScope } from '../contracts.js';
import { StorageInvalidCommandError, UnsupportedProfileError } from '../errors.js';
import { CanonicalOwnershipError } from '../instance-ownership.js';
import { createKernel, type KernelRoot } from '../kernel.js';
import type { ProfileClaim, ProfileId } from '../profiles.js';
import {
  createRootStagedKernel,
  type StagedKernelOptions,
  type StagedKernelRoot,
} from '../staged-factory.js';
import {
  CANONICAL_INSTANCE_OWNERSHIP_CONTRACT,
  CanonicalInstanceRegistry,
} from '../instance-ownership.js';
import { openSqliteEngine, type SqliteEngine, type SqliteOpenOptions } from './engine.js';
import { SqliteStateBackend } from './backend.js';

const SQLITE_MEANINGS = {
  'atomic-units-v1':
    'owned bounded plans;single-writer sequential transactions;one root CAS;durable complete receipts;immutable flush retries only',
  'immutable-chains-v1': 'canonical byte payloads;per-chain allocation;ordered head CAS;retained identities',
  'immutable-boundaries-v1':
    'exact head sequence allocation HMAC;owner scope incarnation root manifests;current coverage;no TTL;full page envelopes',
  'scope-outbox-v1':
    'one committed segment in selected log;same-session append replay;contiguous fenced checkpoints;registered snapshot resync;poison retained',
  'visibility-barriers-v1':
    'persistent ancestry;atomic barrier and content publication;current getter/page denial;covered reparenting refused',
  'staged-units-v1':
    'comments framed SHA256 v1;owned ordinals and authenticated owner capabilities;portable bounded preparation;frozen root CAS;terminal recovery',
  'fenced-writers-v1':
    'durable owner epoch incarnation lanes;host-clock leases;post-wait gate checks;explicit recovery and rotation',
  'purge-jobs-v1':
    'durable bounded jobs;holds and shared references;canonical bytes and staged-item erasure;one verified outcome and notification;no archive restore claim',
} as const;

type TransactionalProfile = keyof typeof SQLITE_MEANINGS;

// Lot 1 restart-durable subset: only state inside the persisted scope
// snapshot (records, chains/heads, index, aggregates, idempotency commits)
// survives close/reopen. Staged attachment, journal lanes, consumers,
// barriers, fences and purge jobs stay session-local, so their profiles
// remain disabled until S2-S4 deliver and qualify them.
const LOT1_DURABLE_PROFILES: ReadonlySet<TransactionalProfile> = new Set([
  'atomic-units-v1',
  'immutable-chains-v1',
  'immutable-boundaries-v1',
]);

const SQLITE_CLAIMS: readonly ProfileClaim[] = Object.freeze(
  Object.entries(SQLITE_MEANINGS).map(([profile, meaning]) =>
    Object.freeze({
      profile: profile as ProfileId,
      version: '1',
      digest: createHash('sha256').update(JSON.stringify(['storage-profile', 'v1', profile, meaning])).digest('hex'),
    }),
  ),
);

export const sqliteProfileClaims = (module: string, resync: boolean): readonly ProfileClaim[] =>
  Object.freeze(
    SQLITE_CLAIMS.filter(
      (claim) =>
        LOT1_DURABLE_PROFILES.has(claim.profile as TransactionalProfile) &&
        (module === 'comments' || claim.profile !== 'staged-units-v1') &&
        (resync || claim.profile !== 'scope-outbox-v1'),
    ),
  );

const READONLY_METHODS = new Set([
  'capability', 'requireOperation', 'readHead', 'readChain', 'readRecord', 'readAggregate', 'readPage',
  'indexGet', 'inspectStaged', 'journalFence', 'journalRead', 'journalInspect', 'externalRead', 'snapshotRead',
  'auditRead', 'purgeProgress', 'purgeJobIds', 'purgeEvidence', 'recoveryEvidence', 'verifyManifest',
  'manifestReadPage', 'readBlob', 'query',
]);

const SYNC_METHODS = new Set(['requireOperation', 'capability']);

const persistAfter = <T extends object>(bound: T, backend: SqliteStateBackend, engine: SqliteEngine, scope: StorageScope): T =>
  new Proxy(bound, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;
      // Possession is verified before every call, reads included: loss is
      // terminal and revokes dependent readers. Only mutations persist.
      // Sync ports keep their sync contract; async refusals reject.
      if (SYNC_METHODS.has(String(property))) {
        return (...args: never[]) => {
          engine.assertOwnership();
          return (value as (...args: never[]) => unknown).apply(target, args);
        };
      }
      return async (...args: never[]) => {
        const release = backend.admit();
        try {
          engine.assertOwnership();
          if (READONLY_METHODS.has(String(property))) {
            const outcome = await (value as (...args: never[]) => unknown).apply(target, args);
            engine.assertOwnership();
            return outcome;
          }
          // Admission excludes readers and other mutations until rollback
          // or durable publication has completed. Inner-op atomicity stays
          // with the coordinator and its captured root identity.
          const snapshot = backend.snapshotScope(scope);
          const outcome = await (value as (...args: never[]) => unknown).apply(target, args);
          try {
            engine.assertOwnership();
            backend.flushScope(scope);
          } catch (error) {
            backend.restoreScope(scope, snapshot);
            throw error;
          }
          return outcome;
        } finally {
          release();
        }
      };
    },
  }) as T;

export interface SqliteKernelOptions extends Omit<StagedKernelOptions, 'backend' | 'coordinator' | 'moduleId'> {
  readonly path: string;
  readonly moduleId: string;
  readonly open?: Omit<SqliteOpenOptions, 'path'>;
}

export interface SqliteKernel {
  readonly engine: SqliteEngine;
  readonly backend: SqliteStateBackend;
  readonly moduleId: string;
  readonly incarnation: string;
  readonly ownershipContract: typeof CANONICAL_INSTANCE_OWNERSHIP_CONTRACT;
  bind(grant: ScopeGrant<unknown>): unknown;
  bindNew(grant: ScopeGrant<unknown>): unknown;
  revoke(token: string): void | Promise<void>;
  provisionFence(...args: Parameters<StagedKernelRoot['provisionFence']>): unknown;
  profiles(resync: boolean): readonly ProfileClaim[];
  close(): void;
}

export const createSqliteKernel = (options: SqliteKernelOptions): SqliteKernel => {
  const { path, moduleId, open, ...neutral } = options;
  if (typeof moduleId !== 'string' || moduleId.length === 0) {
    throw new StorageInvalidCommandError('sqlite kernel requires a moduleId');
  }
  const engine = openSqliteEngine({ ...(open ?? {}), path, moduleId });
  const backend = new SqliteStateBackend(engine);
  const staged = moduleId === 'comments';
  const inner: StagedKernelRoot | KernelRoot = staged
    ? createRootStagedKernel({ ...neutral, backend, moduleId })
    : createKernel({ ...neutral, backend, moduleId });
  const wrapScope = <T extends object>(bound: T, grant: ScopeGrant<unknown>): T =>
    persistAfter(bound, backend, engine, { tenantId: grant.scope.tenantId, workspaceId: grant.scope.workspaceId });
  const kernel: SqliteKernel = {
    engine,
    backend,
    moduleId: inner.moduleId,
    incarnation: inner.incarnation,
    ownershipContract: CANONICAL_INSTANCE_OWNERSHIP_CONTRACT,
    bind: (grant) => wrapScope(inner.bind(grant) as object, grant),
    bindNew: (grant) => wrapScope(inner.bindNew(grant) as object, grant),
    revoke: (token) => inner.revoke(token),
    provisionFence: (...args: Parameters<StagedKernelRoot['provisionFence']>): unknown => {
      if (!('provisionFence' in inner)) throw new UnsupportedProfileError('staged-units-v1');
      return (inner as StagedKernelRoot).provisionFence(...args);
    },
    profiles: (resync) => sqliteProfileClaims(moduleId, resync),
    close: (): void => {
      backend.assertIdle();
      try {
        backend.flushAll();
      } catch (error) {
        if (!(error instanceof CanonicalOwnershipError)) throw error;
      }
      engine.close();
    },
  };
  return Object.freeze(kernel);
};

export { CanonicalInstanceRegistry };
