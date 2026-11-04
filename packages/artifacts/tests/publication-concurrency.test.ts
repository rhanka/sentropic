/**
 * Bounded concurrency in `publishFinalized` blob staging and
 * `verifyStagedBlobs` read-back (#art-conc, P1).
 *
 * Latency-injected fakes prove that wall time drops close to ceil(n/k) round
 * trips, that a mid-batch failure rolls back cleanly with the original error
 * object, that the in-flight limit is never exceeded (default 6, configured
 * values clamped to 8), that one shared deadline bounds the whole batch, and
 * that provider error codes project unchanged through `classifyArtifactFailure`.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createGuardedPublicationService,
  createMemoryBlobStore,
  resolveBlobConcurrency,
  runBlobPool,
  DEFAULT_BLOB_CONCURRENCY,
  MAX_BLOB_CONCURRENCY,
  type GuardedPublicationDeps,
  type PublicationBlobStore,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createMemoryRefcountStore } from '../src/server/gc.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';
import type { FinalizeRequest, FinalizeResult } from '../src/server/commit/types.js';
import { createArtifactCommand, createRadarKeyDerivation } from '../src/server/command-identity.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FILES = Array.from({ length: 30 }, (_, i) => ({
  path: `file-${i}.html`, mimeType: 'text/html', bytes: new Uint8Array([i + 1, i + 2, i + 3]),
}));
const digestOf = (file: { bytes: Uint8Array }) =>
  `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`;
const keyOf = (file: { bytes: Uint8Array }) => `artifacts/scope-1/blobs/sha256/${digestOf(file).slice(7)}`;

/** Blob-store double with injected per-op latency, in-flight tracking and optional failure injection. */
function latencyBlobStore(options: {
  latencyMs: number;
  failPutKeys?: ReadonlySet<string>;
  putError?: () => Error;
}) {
  const inner = createMemoryBlobStore();
  const state = { inFlight: 0, maxInFlight: 0, putStarted: 0, getStarted: 0 };
  const track = async <T>(op: () => Promise<T>): Promise<T> => {
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await sleep(options.latencyMs);
      return await op();
    } finally {
      state.inFlight -= 1;
    }
  };
  const store: PublicationBlobStore = {
    putBlob: (key, bytes) => track(async () => {
      state.putStarted += 1;
      if (options.failPutKeys?.has(key)) throw (options.putError ?? (() => new Error('put failed')))();
      await inner.putBlob(key, bytes);
    }),
    getBlob: (key) => track(async () => {
      state.getStarted += 1;
      return inner.getBlob(key);
    }),
    listKeys: (prefix) => inner.listKeys(prefix),
    deleteBlob: (key) => inner.deleteBlob(key),
  };
  return { store, state, inner };
}

function guardedFixture(deps: {
  blobs: PublicationBlobStore;
  finalize?: (request: FinalizeRequest) => Promise<FinalizeResult>;
  blobConcurrency?: number;
  blobDeadlineMs?: number;
}) {
  const refs = createMemoryRefcountStore();
  const finalize = deps.finalize ?? (async () => ({ ok: false, failure: { commitState: 'not_committed' } }) as FinalizeResult);
  const finalizePrepared = vi.fn(finalize);
  const intents = createMemoryIntentStore();
  const publicationDeps: GuardedPublicationDeps = {
    coordinator: { finalizePrepared, replayPrepared: finalizePrepared } as GuardedPublicationDeps['coordinator'],
    refs,
    blobs: deps.blobs,
    intents,
    ...(deps.blobConcurrency === undefined ? {} : { blobConcurrency: deps.blobConcurrency }),
    ...(deps.blobDeadlineMs === undefined ? {} : { blobDeadlineMs: deps.blobDeadlineMs }),
    createUnitWriter: () => ({
      lockCurrent: async () => ({ currentReleaseId: null, currentDigest: null }),
      updateMetadata: async (_id, metadata) => metadata,
      readAuthorization: async () => ({ state: 'active', acl: { ownerId: 'owner-1', grants: [], isPublic: false, withdrawn: false } }),
      putSource: async () => {},
      putRelease: async () => {}, registerBlob: async () => {},
      promoteCurrentLatestWins: async () => {}, completeIntent: async () => {},
      addReleaseRef: (digest, holder) => refs.addRef(digest, holder),
    }),
  };
  const input = {
    ownerId: 'owner-1', actorId: 'owner-1', storageScopeId: 'scope-1',
    artifactId: '11111111-1111-4111-8111-111111111111', profile: {},
    files: FILES,
    policyRevision: 'rev-1', callerKey: 'key-1',
  };
  const identity = createArtifactCommand(compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
    'artifacts_publish', { artifactId: input.artifactId, idempotencyKey: input.callerKey,
      files: input.files.map((file) => ({ ...file, bytes: [...file.bytes] })) }, input,
    createRadarKeyDerivation({ storageScopeId: input.storageScopeId, actorIds: [input.actorId] })).identity;
  return { deps: publicationDeps, refs, intents, finalizePrepared, input: { ...input, identity } };
}

const classify = (cause: unknown) => classifyArtifactFailure(cause, {
  invocationId: 'inv-1', operation: 'publish', phase: 'dispatch', commitState: 'not_committed',
});

describe('resolveBlobConcurrency', () => {
  it('defaults to 6 and clamps any configured value to 8', () => {
    expect(resolveBlobConcurrency(undefined)).toBe(DEFAULT_BLOB_CONCURRENCY);
    expect(DEFAULT_BLOB_CONCURRENCY).toBe(6);
    expect(resolveBlobConcurrency(1)).toBe(1);
    expect(resolveBlobConcurrency(8)).toBe(8);
    expect(resolveBlobConcurrency(100)).toBe(MAX_BLOB_CONCURRENCY);
    expect(MAX_BLOB_CONCURRENCY).toBe(8);
    expect(() => resolveBlobConcurrency(0)).toThrow('invalid blob concurrency');
    expect(() => resolveBlobConcurrency(2.5)).toThrow('invalid blob concurrency');
  });
});

describe('runBlobPool', () => {
  it('never exceeds the concurrency limit and rethrows the first fatal error unchanged', async () => {
    const inFlight = { current: 0, max: 0 };
    const sentinel = new Error('boom');
    const items = Array.from({ length: 20 }, (_, i) => i);
    await expect(runBlobPool(items, { concurrency: 4 }, async (item) => {
      inFlight.current += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.current);
      try {
        await sleep(20);
        if (item === 7) throw sentinel;
      } finally {
        inFlight.current -= 1;
      }
    })).rejects.toBe(sentinel);
    expect(inFlight.max).toBeLessThanOrEqual(4);
    expect(inFlight.max).toBeGreaterThan(1);
  });

  it('stops scheduling after the shared deadline and throws a TimeoutError-named error', async () => {
    let started = 0;
    const startedAt = Date.now();
    await expect(runBlobPool(Array.from({ length: 50 }, (_, i) => i), {
      concurrency: 6, deadlineAt: startedAt + 60,
    }, async () => {
      started += 1;
      await sleep(30);
    })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(started).toBeLessThan(50);
    expect(Date.now() - startedAt).toBeLessThan(50 * 30);
  });
});

describe('publishFinalized bounded concurrency (latency-injected fake)', () => {
  it('drops wall time close to ceil(n/k) round trips with the default limit of 6', async () => {
    const { store, state } = latencyBlobStore({ latencyMs: 100 });
    const f = guardedFixture({ blobs: store });
    const started = Date.now();
    await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    const wallMs = Date.now() - started;
    // 30 files x 100 ms sequential = 3000 ms; ceil(30/6) * 100 = 500 ms per phase, ~1000 ms for put+verify.
    expect(wallMs).toBeLessThan(2000);
    expect(wallMs).toBeGreaterThanOrEqual(900);
    expect(state.maxInFlight).toBeLessThanOrEqual(6);
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.putStarted).toBe(30);
    expect(state.getStarted).toBe(30);
  });

  it('respects a configured concurrency of 3', async () => {
    const { store, state } = latencyBlobStore({ latencyMs: 50 });
    const f = guardedFixture({ blobs: store, blobConcurrency: 3 });
    const started = Date.now();
    await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    const wallMs = Date.now() - started;
    // ceil(30/3) * 50 = 500 ms per phase, ~1000 ms for put+verify.
    expect(wallMs).toBeLessThan(1600);
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
    expect(state.maxInFlight).toBeGreaterThan(1);
  });

  it('clamps a configured concurrency above 8 down to 8', async () => {
    const { store, state } = latencyBlobStore({ latencyMs: 50 });
    const f = guardedFixture({ blobs: store, blobConcurrency: 64 });
    await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    expect(state.maxInFlight).toBeLessThanOrEqual(8);
    expect(state.maxInFlight).toBeGreaterThan(6);
  });

  it('rolls back cleanly on a mid-batch PUT failure and keeps the error projection unchanged', async () => {
    const providerTimeout = new Error('ArtifactS3TimeoutError');
    providerTimeout.name = 'TimeoutError';
    (providerTimeout as { code?: string }).code = 'ETIMEDOUT';
    const failingKey = keyOf(FILES[17]);
    const { store, state } = latencyBlobStore({
      latencyMs: 20, failPutKeys: new Set([failingKey]), putError: () => providerTimeout,
    });
    const f = guardedFixture({ blobs: store });
    let thrown: unknown;
    try {
      await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    } catch (error) {
      thrown = error;
    }
    // The exact same provider error object reaches the caller (identical projection input).
    expect(thrown).toBe(providerTimeout);
    // No finalization, nothing committed.
    expect(f.finalizePrepared).not.toHaveBeenCalled();
    // First-fatal cancellation: not all 30 PUTs were started.
    expect(state.putStarted).toBeLessThan(30);
    // Pins are released again (cleanup unchanged).
    for (const file of FILES) expect(await f.refs.count(digestOf(file))).toBe(0);
    // The intent stays pending (all-or-nothing: nothing visible).
    expect((await f.intents.listPending()).every((intent) => intent.state === 'pending')).toBe(true);
    // Error codes unchanged: same classification as the sequential loop.
    expect(classify(thrown)).toMatchObject({
      kind: 'operational', category: 'provider_unavailable', httpStatus: 503,
      publicCode: 'capability_unavailable', retriable: true,
    });
  });

  it('keeps the ArtifactOperationError projection identical on a mid-batch failure', async () => {
    const sentinel = new ArtifactOperationError('provider_unavailable');
    const failingKey = keyOf(FILES[10]);
    const { store } = latencyBlobStore({
      latencyMs: 10, failPutKeys: new Set([failingKey]), putError: () => sentinel,
    });
    const f = guardedFixture({ blobs: store });
    let thrown: unknown;
    try {
      await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(sentinel);
    expect(classify(thrown)).toMatchObject({
      kind: 'operational', category: 'provider_unavailable', variant: 'dispatch_failure',
      httpStatus: 503, publicCode: 'capability_unavailable', retriable: true,
    });
  });

  it('keeps the read-back digest-mismatch error unchanged under concurrency', async () => {
    const { store, inner } = latencyBlobStore({ latencyMs: 5 });
    const corrupted = keyOf(FILES[5]);
    const originalPut = store.putBlob;
    const wrapped: PublicationBlobStore = {
      ...store,
      putBlob: async (key, bytes) => {
        await originalPut(key, bytes);
        if (key === corrupted) await inner.putBlob(key, new Uint8Array([9, 9, 9]));
      },
    };
    const f = guardedFixture({ blobs: wrapped });
    let thrown: unknown;
    try {
      await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(`publication digest mismatch for ${corrupted}: read-back failed`);
    expect(f.finalizePrepared).not.toHaveBeenCalled();
  });

  it('bounds the whole batch by one shared deadline (blobDeadlineMs) and classifies expiry like a provider timeout', async () => {
    const { store, state } = latencyBlobStore({ latencyMs: 100 });
    const f = guardedFixture({ blobs: store, blobDeadlineMs: 350 });
    const started = Date.now();
    let thrown: unknown;
    try {
      await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    } catch (error) {
      thrown = error;
    }
    const wallMs = Date.now() - started;
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('TimeoutError');
    // No new operation starts after the shared deadline: far fewer than 30 PUTs.
    expect(state.putStarted).toBeLessThan(30);
    expect(wallMs).toBeLessThan(30 * 100);
    expect(classify(thrown)).toMatchObject({
      kind: 'operational', category: 'provider_unavailable', httpStatus: 503,
      publicCode: 'capability_unavailable', retriable: true,
    });
    expect(f.finalizePrepared).not.toHaveBeenCalled();
  });

  it('still verifies every staged blob and finalizes when all operations succeed', async () => {
    const { store, state, inner } = latencyBlobStore({ latencyMs: 10 });
    const f = guardedFixture({ blobs: store });
    f.deps.coordinator = {
      finalizePrepared: vi.fn(async () => ({ ok: true, result: {
        scopeId: 'scope-1', internalKey: f.input.identity.internalKey,
        commandHash: f.input.identity.commandHash, codecVersion: f.input.identity.codecVersion,
        receipt: { releaseId: 'r1', manifest: 'm' }, createdAt: new Date().toISOString(),
      }, invocationId: 'inv-1', commitState: 'committed', replayed: false }) as FinalizeResult),
      replayPrepared: async () => undefined,
    } as GuardedPublicationDeps['coordinator'];
    const outcome = await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    expect(outcome.ok).toBe(true);
    expect(state.putStarted).toBe(30);
    expect(state.getStarted).toBe(30);
    expect(state.maxInFlight).toBeLessThanOrEqual(6);
    for (const file of FILES) expect(await inner.getBlob(keyOf(file))).toBeDefined();
  });
});
