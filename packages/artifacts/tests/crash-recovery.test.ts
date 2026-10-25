/**
 * L-5b — crash recovery: interrupt at every boundary, reconcile, retry.
 *
 * A crash after blob writes leaves a pending intent and addressable but
 * enumerable orphan blobs — never a visible release. A crash between the
 * release write and the CAS promotion leaves a ready-but-uncurrent release
 * that reconcile promotes explicitly. Reconcile reports done/failed per
 * intent; a failed intent requires an explicit retry, which then converges
 * on exactly one visible release.
 */
import { describe, expect, it } from 'vitest';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
  type PublicationBlobStore,
  type PublicationStateStore,
} from '../src/server/publication.js';
import {
  createMemoryIntentStore,
  reconcileIntents,
  type ObjectIntent,
} from '../src/server/object-intents.js';
import {
  createGcService,
  createMemoryRefcountStore,
  createMemoryDeletionClaimStore,
} from '../src/server/gc.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import { parseManifest } from '../src/codecs.js';

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

const FILES = [
  { path: 'a.html', mimeType: 'text/html', bytes: owe([1]) },
  { path: 'b.html', mimeType: 'text/html', bytes: owe([2]) },
];

function makeService(state: PublicationStateStore, blobs: PublicationBlobStore) {
  const intents = createMemoryIntentStore();
  const service = createPublicationService({
    state,
    blobs,
    intents,
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
  });
  return { service, intents };
}

const BASE = {
  ownerId: 'owner-1',
  storageScopeId: 'scope-1',
  artifactId: '11111111-1111-4111-8111-111111111111',
  profile: { title: 'Hello' },
};

describe('crash recovery', () => {
  it('recovers a crash after blob writes: orphans enumerable, retry converges', async () => {
    const blobs = createMemoryBlobStore();
    const realPut = blobs.putBlob.bind(blobs);
    let puts = 0;
    blobs.putBlob = async (key: string, bytes: Uint8Array) => {
      puts += 1;
      if (puts === 2) throw new Error('crash after first blob');
      return realPut(key, bytes);
    };
    const { service, intents } = makeService(createMemoryStateStore(), blobs);
    await expect(
      service.publish({ ...BASE, files: FILES, idempotencyKey: 'k-1', paramsHash: 'h-1' }),
    ).rejects.toThrow(/crash after first blob/);
    expect(await service.getCurrent(BASE.artifactId)).toBeUndefined();
    const orphans = await blobs.listKeys(`artifacts/${BASE.storageScopeId}/blobs/`);
    expect(orphans.length).toBe(1);
    const report = await reconcileIntents(intents, async (intent: ObjectIntent) => {
      const keys = intent.payload['blobKeys'];
      expect(Array.isArray(keys)).toBe(true);
      return 'failed';
    });
    expect(report.failed.length).toBe(1);
    expect(report.done.length).toBe(0);
    const retried = await service.publish({ ...BASE, files: FILES, idempotencyKey: 'k-2', paramsHash: 'h-1' });
    expect((await service.getCurrent(BASE.artifactId))?.releaseId).toBe(retried.releaseId);
    expect(await intents.listPending()).toEqual([]);
  });

  it('recovers a crash between release write and promotion', async () => {
    const state = createMemoryStateStore();
    const realCas = state.compareAndSwapCurrent.bind(state);
    let casCalls = 0;
    state.compareAndSwapCurrent = async (artifactId: string, expected: string | null, next: string) => {
      casCalls += 1;
      if (casCalls === 1) throw new Error('crash before promotion');
      return realCas(artifactId, expected, next);
    };
    const blobs = createMemoryBlobStore();
    const { service, intents } = makeService(state, blobs);
    await expect(
      service.publish({ ...BASE, files: FILES, idempotencyKey: 'k-1', paramsHash: 'h-1' }),
    ).rejects.toThrow(/crash before promotion/);
    expect(await service.getCurrent(BASE.artifactId)).toBeUndefined();
    const report = await reconcileIntents(intents, async (intent: ObjectIntent) => {
      const releaseId = intent.payload['releaseId'];
      const stored = typeof releaseId === 'string' ? await state.getRelease(releaseId) : undefined;
      if (stored === undefined) return 'failed';
      const promoted = await state.compareAndSwapCurrent(BASE.artifactId, null, stored.releaseId);
      return promoted ? 'done' : 'failed';
    });
    expect(report.done.length).toBe(1);
    const current = await service.getCurrent(BASE.artifactId);
    expect(current).not.toBeUndefined();
    expect(parseManifest(current?.manifest ?? '')).toMatchObject({ artifactId: BASE.artifactId });
    expect(await intents.listPending()).toEqual([]);
  });

  it('fails a denied attempt without promotion and cleans only orphan blobs', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const gc = createGcService(refs);
    const { intents } = makeService(createMemoryStateStore(), blobs);
    const prefix = `artifacts/${BASE.storageScopeId}/blobs/`;
    // A committed release pins the shared blob; the denied attempt staged an orphan.
    const sharedKey = `${prefix}sha256/${'cc'.repeat(32)}`;
    const orphanKey = `${prefix}sha256/${'dd'.repeat(32)}`;
    await blobs.putBlob(sharedKey, owe([10]));
    await blobs.putBlob(orphanKey, owe([11]));
    await refs.addRef('sha256:' + 'cc'.repeat(32), 'release-committed');
    // The denied attempt's preparation intent carries attribution but no effect.
    const denied = await intents.record('commit-release', {
      artifactId: BASE.artifactId,
      releaseId: 'release-denied',
      manifestDigest: 'sha256:' + 'dd'.repeat(32),
      blobKeys: [orphanKey],
      attemptId: 'attempt-denied-9',
      operation: 'publish',
      cleanupDeadlineMs: Date.now() - 1,
    });
    const report = await reconcileIntents(intents, async (intent: ObjectIntent) => {
      if (intent.intentId === denied.intentId) return 'failed';
      return 'failed';
    });
    expect(report.failed.length).toBe(1);
    expect(report.done.length).toBe(0);
    // Recovery never promotes: no release, no pointer for the denied attempt.
    const collection = await gc.collect(blobs, prefix, createMemoryDeletionClaimStore());
    expect(collection.deleted).toEqual([orphanKey]);
    expect(collection.retained).toEqual([sharedKey]);
    expect(await refs.count('sha256:' + 'cc'.repeat(32))).toBe(1);
    expect(await blobs.getBlob(orphanKey)).toBeUndefined();
    expect(await blobs.getBlob(sharedKey)).not.toBeUndefined();
  });
});
