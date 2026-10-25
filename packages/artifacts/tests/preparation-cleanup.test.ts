import { describe, expect, it } from 'vitest';
import { createMemoryIntentStore, inspectPreparations, scheduleBoundedPreparationCleanup } from '../src/server/object-intents.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import { createMemoryDeletionClaimStore, createMemoryRefcountStore } from '../src/server/gc.js';

const keys = ['aa', 'bb'].map((hex) => `artifacts/s/blobs/sha256/${hex.repeat(32)}`);
const digest = (key: string) => `sha256:${key.split('/').pop()}`;
function fixture() {
  return { intents: createMemoryIntentStore(), blobs: createMemoryBlobStore(),
    refs: createMemoryRefcountStore(), claims: createMemoryDeletionClaimStore() };
}
async function attempt(host: ReturnType<typeof fixture>, id: string, blobKeys = keys) {
  for (const key of blobKeys) {
    await host.refs.pin(digest(key), `preparation:${id}`);
    await host.blobs.putBlob(key, new Uint8Array([1]));
  }
  return host.intents.record('commit-release', { artifactId: 'a', releaseId: id,
    attemptId: id, invocationId: `inv-${id}`, blobKeys, preparedAtMs: 10, cleanupDeadlineMs: 100 });
}

describe('bounded preparation cleanup', () => {
  it('should retain attribution and shared bytes while settling expired preparation debt', async () => {
    const host = fixture();
    await attempt(host, 'denied');
    await host.refs.addRef(digest(keys[0]!), 'committed-release');
    const before = await inspectPreparations(host, 'a');
    expect(before.attempts).toEqual([expect.objectContaining({ attemptId: 'denied',
      invocationId: 'inv-denied', preparedAtMs: 10, cleanupDeadlineMs: 100, blobKeys: keys })]);
    await scheduleBoundedPreparationCleanup(host, 99);
    expect(await host.blobs.getBlob(keys[1]!)).toBeDefined();
    await scheduleBoundedPreparationCleanup(host, 100);
    const after = await inspectPreparations(host, 'a');
    expect(after.attempts).toEqual([expect.objectContaining({ ...before.attempts[0], state: 'failed-cleaned' })]);
    expect(after.protectedKeys).toEqual([keys[0]]);
    expect(await host.blobs.getBlob(keys[0]!)).toBeDefined();
    expect(await host.blobs.getBlob(keys[1]!)).toBeUndefined();
    await scheduleBoundedPreparationCleanup(host, 200);
  });

  it('should preserve another active preparation and retry measurable cleanup failures', async () => {
    const host = fixture();
    await attempt(host, 'expired');
    await host.refs.pin(digest(keys[0]!), 'preparation:active');
    const del = host.blobs.deleteBlob;
    host.blobs.deleteBlob = async () => { throw new Error('storage unavailable'); };
    await expect(scheduleBoundedPreparationCleanup(host, 100)).rejects.toThrow(/cleanup/);
    expect((await inspectPreparations(host, 'a')).attempts[0]?.state).toBe('failed');
    host.blobs.deleteBlob = del;
    await scheduleBoundedPreparationCleanup(host, 100);
    expect(await host.blobs.getBlob(keys[0]!)).toBeDefined();
    expect(await host.blobs.getBlob(keys[1]!)).toBeUndefined();
  });

  it('should bound each sweep and retain the remaining debt', async () => {
    const host = { ...fixture(), cleanupBatchSize: 1 };
    await attempt(host, 'first', [keys[0]!]);
    await attempt(host, 'second', [keys[1]!]);
    await scheduleBoundedPreparationCleanup(host, 100);
    expect((await inspectPreparations(host, 'a')).attempts.map((a) => a.state)).toEqual(['failed-cleaned', 'pending-cleanup']);
    await scheduleBoundedPreparationCleanup(host, 100);
    expect((await inspectPreparations(host, 'a')).attempts.every((a) => a.state === 'failed-cleaned')).toBe(true);
  });
});
