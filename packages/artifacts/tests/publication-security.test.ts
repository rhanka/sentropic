import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore, createMemoryStateStore, createPublicationService } from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';

const INPUT = {
  ownerId: 'alice', storageScopeId: 'scope-1', artifactId: 'artifact-1', profile: {},
  files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([1, 2]) }],
};
function world() {
  const blobs = createMemoryBlobStore();
  const intents = createMemoryIntentStore();
  const service = createPublicationService({ state: createMemoryStateStore(), blobs, intents,
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()) });
  return { service, blobs, intents };
}

describe('publication security', () => {
  it.each(['../x', '/x', 'x/../y', 'x//y', './x', 'x/', 'x\\y', '%2e%2e/x',
    'a%2fb', 'x?query', 'x#fragment', 'x\u0000', 'https://host/x', 'x'.repeat(1025)])(
    'should refuse unsafe path %s before any external effect', async (path) => {
      const { service, blobs, intents } = world();
      await expect(service.publish({ ...INPUT, files: [{ ...INPUT.files[0]!, path }] }))
        .rejects.toThrow(/invalid.*path/);
      expect(await blobs.listKeys('')).toEqual([]);
      expect(await intents.listPending()).toEqual([]);
      expect(await service.getCurrent(INPUT.artifactId)).toBeUndefined();
    },
  );

  it('should refuse empty publications and duplicate paths before writing', async () => {
    const { service, blobs } = world();
    await expect(service.publish({ ...INPUT, files: [] })).rejects.toThrow(/invalid/);
    await expect(service.publish({ ...INPUT, files: [...INPUT.files, ...INPUT.files] })).rejects.toThrow(/duplicate/);
    expect(await blobs.listKeys('')).toEqual([]);
  });

  it('should bind replay to actual bytes and metadata rather than caller hashes', async () => {
    const { service } = world();
    const input = { ...INPUT, idempotencyKey: 'same', paramsHash: 'forged' };
    const first = await service.publish(input);
    expect(await service.publish({ ...input, paramsHash: 'changed' })).toEqual(first);
    for (const changed of [
      { ...input, artifactId: 'other' }, { ...input, profile: { title: 'changed' } },
      { ...input, files: [{ ...INPUT.files[0]!, bytes: new Uint8Array([3]) }] },
      { ...input, files: [{ ...INPUT.files[0]!, mimeType: 'text/plain' }] },
      { ...input, files: [{ ...INPUT.files[0]!, path: 'other.html' }] },
    ]) await expect(service.publish(changed)).rejects.toThrow(/idempotency conflict/);
  });

  it('should isolate the same publication key between principals', async () => {
    const { service } = world();
    const first = await service.publish({ ...INPUT, idempotencyKey: 'shared' });
    const second = await service.publish({ ...INPUT, ownerId: 'bob', artifactId: 'other', idempotencyKey: 'shared' });
    expect(second.releaseId).not.toBe(first.releaseId);
  });
});
