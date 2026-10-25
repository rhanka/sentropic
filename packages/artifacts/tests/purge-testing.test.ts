import { expect, it } from 'vitest';
import { pausePurgeBeforeDelete, inspectDeletionClaims } from '../src/testing.js';
import { createGcService, createMemoryDeletionClaimStore, createMemoryRefcountStore } from '../src/server/gc.js';
import { createMemoryBlobStore, type PublicationBlobStore } from '../src/server/publication.js';

const key = `artifacts/s/blobs/sha256/${'aa'.repeat(32)}`;
const digest = `sha256:${'aa'.repeat(32)}`;
it('should pause only the requested purge with inspectable claims retained until deletion finishes', async () => {
  const blobs = createMemoryBlobStore();
  const refs = createMemoryRefcountStore();
  const claims = createMemoryDeletionClaimStore();
  const orphan = `artifacts/s/blobs/sha256/${'00'.repeat(32)}`;
  await blobs.putBlob(orphan, new Uint8Array([9]));
  await blobs.putBlob(key, new Uint8Array([1]));
  const host = { blobs, claims, storageScopeId: 's',
    async purge(artifactId: string, deleting: PublicationBlobStore) {
      await claims.claim(digest, `purge:${artifactId}`);
      const report = await createGcService(refs).collect(deleting, 'artifacts/s/', claims);
      if (report.failures.length) throw new Error('purge failed');
    } };
  const paused = await pausePurgeBeforeDelete(host, 'a');
  expect(await blobs.getBlob(orphan)).toBeUndefined();
  expect(paused.blobKeys).toEqual([key]);
  expect(await inspectDeletionClaims(host)).toEqual(expect.arrayContaining([expect.objectContaining({
    claimId: paused.claimId, state: 'pending', blobKeys: [key] }),
    expect.objectContaining({ state: 'done', blobKeys: [orphan] })]));
  expect(await blobs.getBlob(key)).toBeDefined();
  let finished = false;
  void paused.finished.then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  paused.release();
  await paused.finished;
  expect(await blobs.getBlob(key)).toBeUndefined();
  expect(await inspectDeletionClaims(host)).toEqual(expect.arrayContaining([
    expect.objectContaining({ claimId: paused.claimId, state: 'done' })]));
});

it('should reject a purge which never reaches external deletion', async () => {
  const host = { blobs: createMemoryBlobStore(), claims: createMemoryDeletionClaimStore(),
    storageScopeId: 's', purge: async () => { throw new Error('purge refused'); } };
  await expect(pausePurgeBeforeDelete(host, 'denied')).rejects.toThrow('purge refused');
});
