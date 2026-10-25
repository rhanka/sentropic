import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore, createMemoryStateStore, createPublicationService } from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';

const INPUT = {
  ownerId: 'alice', storageScopeId: 'scope-1', artifactId: 'artifact-1', profile: {},
  files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([1, 2]) }],
};
function world(limits = {}) {
  const blobs = createMemoryBlobStore();
  const intents = createMemoryIntentStore();
  const service = createPublicationService({ state: createMemoryStateStore(), blobs, intents, limits,
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()) });
  return { service, blobs, intents };
}

describe('publication security', () => {
  it.each([{ kind: 'Uint8Array', bytes: new Uint8Array([1]) }, { kind: 'Buffer', bytes: Buffer.from([1]) }])(
    'should snapshot caller $kind bytes before asynchronous publication effects', async ({ bytes }) => {
      const blobs = createMemoryBlobStore();
      const intents = createMemoryIntentStore();
      const service = createPublicationService({ state: createMemoryStateStore(), blobs,
        intents: { ...intents, record: (...args) => {
          bytes[0] = 2;
          return intents.record(...args);
        } } });
      const result = await service.publish({ ...INPUT, files: [{ ...INPUT.files[0]!, bytes }] });
      const { digest } = JSON.parse(result.manifest).files[0] as { digest: string };
      expect([...await blobs.getBlob(`artifacts/scope-1/blobs/sha256/${digest.slice(7)}`) ?? []])
        .toEqual([1]);
    },
  );

  it('should enforce file count, per-file bytes and total bytes at their boundaries', async () => {
    const { service, blobs, intents } = world({ maxFiles: 2, maxFileBytes: 2, maxTotalBytes: 3 });
    const file = INPUT.files[0]!;
    for (const files of [
      [{ ...file, bytes: new Uint8Array(3) }],
      [file, { ...file, path: 'second' }],
      [file, { ...file, path: 'second' }, { ...file, path: 'third' }],
    ]) await expect(service.publish({ ...INPUT, files })).rejects.toThrow(/budget/);
    expect(await blobs.listKeys('')).toEqual([]);
    expect(await intents.listPending()).toEqual([]);
    const accepted = await service.publish({ ...INPUT, files: [file,
      { ...file, path: 'nested/é.txt', bytes: new Uint8Array(1) }] });
    expect(accepted.releaseId).toBeDefined();
    for (const value of [0, -1, Infinity, NaN, 1.5]) expect(() => world({ maxFiles: value })).toThrow(/invalid/);
  });

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

// Historical success alone never authorizes a 0.2.0 replay.
it.each(['direct', 'ensure', 'publish'])('should quarantine legacy %s records without changing data', async (encoding) => {
  const { assertArtifactReplayMigration } = await import('../src/server/idempotency.js');
  const { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } = await import('../src/profile/index.js');
  const { createArtifactCommand, createRadarKeyDerivation } = await import('../src/server/command-identity.js');
  const { createMemoryKv } = await import('../src/server/ports.js');
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const invocation = { invocationId: 'migration-1', actorId: 'alice', storageScopeId: 'scope-l6',
    authorizeCommit: async () => { throw new Error('migration must not invoke a guard'); } };
  const publish = encoding === 'publish';
  const artifactId = '00000000-0000-4000-8000-000000000001';
  const command = createArtifactCommand(profile, publish ? 'artifacts_publish' : 'artifacts_ensure', publish
    ? { artifactId, idempotencyKey: 'caller-key', files: [{ path: 'index.html', mimeType: 'text/html', text: 'x' }] }
    : { bindingName: 'site', idempotencyKey: 'caller-key' }, invocation,
  createRadarKeyDerivation({ storageScopeId: 'scope-l6', actorIds: ['alice'] }));
  const key = encoding === 'direct' ? command.identity.internalKey : JSON.stringify(publish
    ? ['publish', 'alice', artifactId, command.identity.internalKey] : ['ensure', 'alice', 'caller-key']);
  const kv = createMemoryKv();
  const raw = JSON.stringify({ paramsHash: 'unproven', result: { artifactId } });
  await kv.putIfAbsent(`idempotency:${key}`, raw);
  await expect(assertArtifactReplayMigration(kv, command, invocation, 'caller-key')).rejects.toMatchObject({ name: 'CommitQuarantineError' });
  expect(await kv.get(`idempotency:${key}`)).toBe(raw);
});
