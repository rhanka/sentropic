/**
 * L-5c — garbage collection: refcounts, pins, collected orphans.
 *
 * Blobs stay alive while referenced (per-digest counters) or pinned
 * (explicit retention against concurrent GC). Collection deletes only
 * unreferenced, unpinned blobs and reports per-key failures without
 * throwing — revoked access, pending purge and actual erasure stay
 * distinguishable in the report. Pinned blobs survive even at zero
 * references; a missing blob at delete time is a recorded failure.
 */
import { describe, expect, it } from 'vitest';
import {
  createPostgresGcService,
  createGcService,
  createMemoryRefcountStore,
  createMemoryDeletionClaimStore,
  createClaimGuardedRefs,
} from '../src/server/gc.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import {
  createLifecycleService,
  createMemoryLifecycleStore,
} from '../src/server/lifecycle.js';

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

const KEY_A = `artifacts/scope-1/blobs/sha256/${'aa'.repeat(32)}`;
const KEY_B = `artifacts/scope-1/blobs/sha256/${'bb'.repeat(32)}`;

function digestOf(key: string): string {
  return `sha256:${key.split('/').pop() ?? ''}`;
}

describe('garbage collection', () => {
  it('should keep the PostgreSQL transaction open through exclusion and blob deletion', async () => {
    const events: string[] = [];
    let open = false;
    const refs = createMemoryRefcountStore();
    const blobs = createMemoryBlobStore();
    await blobs.putBlob(KEY_A, owe([1]));
    const gc = createPostgresGcService({
      ensureCoordinationRow: async () => {},
      beginFinalization: async () => {
        open = true;
        events.push('begin');
        return {
          query: async (sql: string) => {
            expect(open).toBe(true);
            if (sql.includes('pg_advisory_xact_lock')) events.push('lock');
            return { rows: [], rowCount: 1 };
          },
          beginReadCommitted: async () => {}, lockOperationKey: async () => {},
          readReceipt: async () => undefined, insertReceipt: async () => {},
          commit: async () => { events.push('commit'); open = false; },
          rollback: async () => { open = false; }, release: () => { events.push('release'); },
        };
      },
    }, () => refs);
    const report = await gc.collect({ ...blobs, deleteBlob: async (key) => {
      expect(open).toBe(true);
      events.push('delete');
      await blobs.deleteBlob(key);
    } }, 'artifacts/');
    expect(report.deleted).toEqual([KEY_A]);
    expect(events).toEqual(['begin', 'lock', 'delete', 'commit', 'release']);
  });

  it('collects unreferenced blobs and reports the report', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const gc = createGcService(refs);
    await blobs.putBlob(KEY_A, owe([1]));
    await blobs.putBlob(KEY_B, owe([2]));
    await refs.addRef(digestOf(KEY_A), 'release-r1');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/', createMemoryDeletionClaimStore());
    expect(report.deleted).toEqual([KEY_B]);
    expect(report.retained).toEqual([KEY_A]);
    expect(report.failures).toEqual([]);
    expect(await blobs.getBlob(KEY_B)).toBeUndefined();
    expect(await blobs.getBlob(KEY_A)).toEqual(owe([1]));
  });

  it('pins survive zero references; missing deletes are failures', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const gc = createGcService(refs);
    const claims = createMemoryDeletionClaimStore();
    await blobs.putBlob(KEY_A, owe([1]));
    await refs.pin(digestOf(KEY_A), 'legal-hold');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/', claims);
    expect(report.deleted).toEqual([]);
    expect(report.retained).toEqual([KEY_A]);
    await refs.unpin(digestOf(KEY_A), 'legal-hold');
    const failingBlobs = {
      ...blobs,
      deleteBlob: async (_key: string) => {
        throw new Error('store exploded');
      },
    };
    const report2 = await gc.collect(failingBlobs, 'artifacts/scope-1/blobs/', claims);
    expect(report2.deleted).toEqual([]);
    expect(report2.failures).toHaveLength(1);
    expect(report2.failures[0]?.error).toMatch(/store exploded/);
    expect(report2.failures[0]?.key).toBe(KEY_A);
    expect(await claims.isClaimed(digestOf(KEY_A))).toBe(false);
  });

  it('serializes concurrent addRef/releaseRef races exactly', async () => {
    const refs = createMemoryRefcountStore();
    const digest = digestOf(KEY_A);
    await Promise.all(Array.from({ length: 25 }, (_, i) => refs.addRef(digest, `holder-${i}`)));
    expect(await refs.count(digest)).toBe(25);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => refs.releaseRef(digest, `holder-${i}`)),
    );
    expect(await refs.count(digest)).toBe(0);
  });

  it('refuses to release unheld references and duplicate pins', async () => {
    const refs = createMemoryRefcountStore();
    const digest = digestOf(KEY_A);
    await expect(refs.releaseRef(digest, 'ghost')).rejects.toThrow(/not held/);
    await refs.pin(digest, 'hold');
    await expect(refs.pin(digest, 'hold')).rejects.toThrow(/duplicate/);
    await refs.unpin(digest, 'hold');
    await expect(refs.unpin(digest, 'hold')).rejects.toThrow(/not pinned/);
  });
});

describe('deletion claims', () => {
  it('should retain retry bytes pinned after the initial GC check', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    const guarded = createClaimGuardedRefs(refs, claims);
    const digest = digestOf(KEY_A);
    await blobs.putBlob(KEY_A, owe([1]));
    let entered!: () => void;
    let resume!: () => void;
    const checked = new Promise<void>((resolve) => { entered = resolve; });
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    let firstCheck = true;
    const gc = createGcService({ ...guarded, isPinned: async (value) => {
      const pinned = await guarded.isPinned(value);
      if (firstCheck) {
        firstCheck = false;
        entered();
        await paused;
      }
      return pinned;
    } });
    const collecting = gc.collect(blobs, 'artifacts/', claims);
    await checked;
    await guarded.pin(digest, 'preparation:retry');
    await blobs.putBlob(KEY_A, owe([1]));
    expect(await blobs.getBlob(KEY_A)).toEqual(owe([1]));
    resume();
    const report = await collecting;
    expect(await guarded.isPinned(digest)).toBe(true);
    expect(report).toEqual({ deleted: [], retained: [KEY_A], failures: [] });
    expect(await blobs.getBlob(KEY_A)).toEqual(owe([1]));
    expect(await claims.isClaimed(digest)).toBe(false);
  });

  it.each(['addRef', 'pin'] as const)('should exclude claims during an in-flight %s', async (operation) => {
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const guarded = createClaimGuardedRefs({ ...refs, [operation]: async (digest: string, holder: string) => {
      entered();
      await paused;
      await refs[operation](digest, holder);
    } }, claims);
    const adding = guarded[operation](digestOf(KEY_A), 'publication');
    await started;
    let claimed = false;
    const claiming = claims.claim(digestOf(KEY_A), 'purge').then(() => { claimed = true; });
    await Promise.resolve();
    await Promise.resolve();
    const claimedBeforeAdd = claimed;
    resume();
    await Promise.all([adding, claiming]);
    expect(claimedBeforeAdd).toBe(false);
    const blobs = createMemoryBlobStore();
    await blobs.putBlob(KEY_A, owe([1]));
    expect((await createGcService(guarded).collect(blobs, 'artifacts/', claims)).retained).toEqual([KEY_A]);
  });

  it('should leave purge retryable when a later digest claim fails', async () => {
    const store = createMemoryLifecycleStore();
    const claims = createMemoryDeletionClaimStore();
    const lifecycle = createLifecycleService(store, undefined, undefined, claims);
    await lifecycle.register('target', 'owner');
    await lifecycle.trackRelease('target', 'release');
    await lifecycle.deleteArtifact('target', 'owner');
    await claims.claim('busy', 'other-purge');
    await expect(lifecycle.purge('target', 'owner', ['free', 'busy'])).rejects.toThrow(/claimed/);
    expect(await lifecycle.stateOf('target')).toBe('deleted');
    expect(await store.getReleaseState('release')).toBe('ready');
    expect(await claims.isClaimed('free')).toBe(false);
    expect(await claims.isClaimed('busy')).toBe(true);
    await claims.releaseClaim('busy');
    await expect(lifecycle.purge('target', 'owner', ['free', 'busy', 'free'])).resolves.toMatchObject({ artifactId: 'target' });
  });

  it('claims exclusively and releases', async () => {
    const claims = createMemoryDeletionClaimStore();
    await claims.claim('sha256:aa', 'purge:a-1');
    await expect(claims.claim('sha256:aa', 'purge:a-2')).rejects.toThrow(/already claimed/);
    expect(await claims.isClaimed('sha256:aa')).toBe(true);
    await claims.releaseClaim('sha256:aa');
    expect(await claims.isClaimed('sha256:aa')).toBe(false);
    await expect(claims.releaseClaim('sha256:aa')).rejects.toThrow(/not claimed/);
  });

  it('refuses new references to claimed digests', async () => {
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    const guarded = createClaimGuardedRefs(refs, claims);
    const digest = digestOf(KEY_A);
    await guarded.addRef(digest, 'release-1');
    await claims.claim(digest, 'purge:a-1');
    await expect(guarded.addRef(digest, 'release-2')).rejects.toThrow(/scheduled for deletion/);
    // Already-held references still count: the blob is protected.
    expect(await guarded.count(digest)).toBe(1);
    await claims.releaseClaim(digest);
    await guarded.addRef(digest, 'release-2');
    expect(await guarded.count(digest)).toBe(2);
  });

  it('deletes unreferenced claimed blobs and acknowledges the claim', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    const gc = createGcService(refs);
    await blobs.putBlob(KEY_A, owe([1]));
    await blobs.putBlob(KEY_B, owe([2]));
    const digestA = digestOf(KEY_A);
    await refs.addRef(digestOf(KEY_B), 'release-live');
    await claims.claim(digestA, 'purge:a-1');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/', claims);
    expect(report.deleted).toEqual([KEY_A]);
    expect(report.retained).toEqual([KEY_B]);
    expect(report.failures).toEqual([]);
    expect(await claims.isClaimed(digestA)).toBe(false);
    expect(await blobs.getBlob(KEY_A)).toBeUndefined();
  });

  it('runs purge end to end: claims, dereference, collect, acknowledge', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    const lifecycle = createLifecycleService(createMemoryLifecycleStore(), undefined, undefined, claims);
    const gc = createGcService(refs);
    const artifactId = 'purge-target';
    await lifecycle.register(artifactId, 'owner-1');
    await lifecycle.withdraw(artifactId, 'owner-1');
    await lifecycle.deleteArtifact(artifactId, 'owner-1');
    const digest = digestOf(KEY_A);
    await blobs.putBlob(KEY_A, owe([9]));
    await refs.addRef(digest, 'release-old');
    const purged = await lifecycle.purge(artifactId, 'owner-1', [digest]);
    expect(purged.blobDigests).toEqual([digest]);
    expect(await claims.isClaimed(digest)).toBe(true);
    // Racing publication cannot pin the claimed blob.
    const guarded = createClaimGuardedRefs(refs, claims);
    await expect(guarded.addRef(digest, 'release-new')).rejects.toThrow(/scheduled for deletion/);
    await refs.releaseRef(digest, 'release-old');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/', claims);
    expect(report.deleted).toEqual([KEY_A]);
    expect(await claims.isClaimed(digest)).toBe(false);
    expect(await lifecycle.stateOf(artifactId)).toBe('purged');
  });

  it('retains a claimed blob while another release still references it', async () => {
    const blobs = createMemoryBlobStore();
    const refs = createMemoryRefcountStore();
    const claims = createMemoryDeletionClaimStore();
    const gc = createGcService(refs);
    const digest = digestOf(KEY_A);
    await blobs.putBlob(KEY_A, owe([3]));
    await refs.addRef(digest, 'release-shared');
    await claims.claim(digest, 'purge:a-1');
    const report = await gc.collect(blobs, 'artifacts/scope-1/blobs/', claims);
    expect(report.deleted).toEqual([]);
    expect(report.retained).toEqual([KEY_A]);
    // The claim stays held while a reference protects the blob.
    expect(await claims.isClaimed(digest)).toBe(true);
    expect(await refs.count(digest)).toBe(1);
  });
});
