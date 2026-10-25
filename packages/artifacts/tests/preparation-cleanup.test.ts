import { describe, expect, it, vi } from 'vitest';
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
  it('should clean and inspect residual bytes without downloading blob contents', async () => {
    const host = fixture();
    await attempt(host, 'no-download');
    vi.spyOn(host.blobs, 'getBlob').mockRejectedValue(new Error('full downloads forbidden'));
    const query = vi.spyOn(host.intents, 'listPreparationIntents');
    await scheduleBoundedPreparationCleanup(host, 100);
    await host.blobs.putBlob(keys[0]!, new Uint8Array([2]));
    expect((await inspectPreparations(host, 'a')).attempts[0]?.state).toBe('failed');
    await scheduleBoundedPreparationCleanup(host, 101);
    expect(await host.blobs.listKeys('artifacts/')).toEqual([]);
    expect(query).toHaveBeenCalledWith({ throughMs: 101, limit: 100 });
  });

  it('should report a legacy invalid intent and still clean valid attempts', async () => {
    const host = fixture();
    const legacy = await host.intents.record('commit-release', { artifactId: 'a',
      attemptId: 'legacy', invocationId: 'old', releaseId: 'old', blobKeys: [], cleanupDeadlineMs: 1 });
    await attempt(host, 'valid');
    await expect(scheduleBoundedPreparationCleanup(host, 100)).rejects.toThrow(/cleanup/);
    expect(await host.blobs.listKeys('artifacts/')).toEqual([]);
    expect((await host.intents.get(legacy.intentId))?.error).toContain('invalid preparation metadata');
    const inventory = await inspectPreparations(host, 'a');
    expect(inventory.invalidIntents).toEqual([expect.objectContaining({ intentId: legacy.intentId })]);
    expect(inventory.attempts[0]?.state).toBe('failed-cleaned');
    await expect(scheduleBoundedPreparationCleanup({ ...host, cleanupBatchSize: 1 }, 101)).resolves.toBeUndefined();
  });

  it('should query only due work in bounded batches ahead of settled history', async () => {
    const host = fixture();
    const done = await attempt(host, 'done', []);
    await host.intents.complete(done.intentId);
    const settled = await attempt(host, 'settled', []);
    await host.intents.markFailed(settled.intentId, 'denied');
    await host.intents.settlePreparationCleanup(settled.intentId);
    const due = await attempt(host, 'due', []);
    expect((await host.intents.listPreparationIntents({ throughMs: 100, limit: 1 }))
      .map((intent) => intent.intentId)).toEqual([due.intentId]);
    expect(await host.intents.listPreparationIntents({ throughMs: 99, limit: 1 })).toEqual([]);
    await host.intents.complete(due.intentId);
    expect(await host.intents.listPreparationIntents({ throughMs: 60_101, limit: 1 })).toEqual([]);
  });

  it('should recover a late external PUT without erasing historical attribution', async () => {
    const host = fixture();
    await attempt(host, 'late-put', [keys[0]!]);
    await scheduleBoundedPreparationCleanup(host, 100);
    // An external PUT acknowledged after a crashed writer's cleanup must remain measurable debt.
    await host.blobs.putBlob(keys[0]!, new Uint8Array([2]));
    expect((await inspectPreparations(host, 'a')).attempts[0]?.state).toBe('failed');
    await scheduleBoundedPreparationCleanup(host, 101);
    expect(await host.blobs.getBlob(keys[0]!)).toBeUndefined();
    expect((await inspectPreparations(host, 'a')).attempts[0]?.attemptId).toBe('late-put');
  });

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
