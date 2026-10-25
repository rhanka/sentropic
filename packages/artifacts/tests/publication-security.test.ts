import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore, createMemoryStateStore, createPublicationService } from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { projectArtifactHttpOutcome } from '../src/http.js';

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

  it('should authorize decoded publish bytes through the host quota participant without recharging', async () => {
    const w = createTransportWorld();
    await w.http('/ensure', { bindingName: 'site', idempotencyKey: 'setup' });
    w.quotaReservations.length = 0;
    const invocation = w.invocation();
    const context = { ...invocation, authorizeCommit: async (commit, transaction) => {
      const admission = await transaction.participant.readAdmission(commit);
      const quota = await transaction.participant.reserveQuota({ storageScopeId: commit.storageScopeId,
        operation: commit.operation, bytes: commit.quotaBytes ?? 0 });
      if (!admission.allowed || !quota.reserved) return {
        allowed: false as const, reason: 'denied' as const, status: 403, publicCode: 'access_denied', retriable: false,
      };
      return { allowed: true as const,
        fence: transaction.participant.mintFence(commit.policyRevision, commit.invocationId) };
    } } satisfies typeof invocation;
    const body = { artifactId: w.bindings.get('alice/site')!, idempotencyKey: 'publish', files: [
      { path: 'index.html', mimeType: 'text/html', text: 'é' },
      { path: 'other.html', mimeType: 'text/html', bytes: [65, 66, 67] },
    ] };
    const first = await w.http('/publish', body, context);
    expect(first).toMatchObject({ ok: true, replayed: false, commitState: 'committed' });
    const replay = await w.http('/publish', body, { ...context, invocationId: 'retry' });
    expect(replay).toMatchObject({ ok: true, replayed: true, commitState: 'committed' });
    expect(w.quotaReservations).toEqual([5]);
    expect(w.releases.size).toBe(1);
  });
});

// Historical success alone never authorizes a 0.2.0 replay.
it.each([
  ['0.1.2', 'ensure', 'caller-key'],
  ['0.1.2', 'publish', 'caller-key'],
  ['0.1.4', 'ensure', '["ensure","alice","caller-key"]'],
  ['0.1.4', 'publish', '["publish","alice","caller-key"]'],
])('should quarantine %s %s retries without changing data', async (_version, operation, key) => {
  const w = createTransportWorld();
  await w.http('/ensure', { bindingName: 'site', idempotencyKey: 'setup' });
  const artifactId = w.bindings.get('alice/site')!;
  const raw = JSON.stringify({ paramsHash: 'unproven', result: { artifactId } });
  await w.legacyRecords.putIfAbsent(`idempotency:${key}`, raw);
  const guardCalls = w.guardCalls();
  const outcome = await w.http(`/${operation}`, operation === 'publish'
    ? { artifactId, idempotencyKey: 'caller-key', files: [{ path: 'index.html', mimeType: 'text/html', text: 'x' }] }
    : { bindingName: 'site', idempotencyKey: 'caller-key' });
  expect(projectArtifactHttpOutcome(outcome).status).toBe(503);
  expect(w.guardCalls()).toBe(guardCalls);
  expect(w.receipts.size).toBe(1);
  expect(w.releases.size).toBe(0);
  expect(await w.blobs.listKeys('')).toEqual([]);
  expect(await w.legacyRecords.get(`idempotency:${key}`)).toBe(raw);
});
