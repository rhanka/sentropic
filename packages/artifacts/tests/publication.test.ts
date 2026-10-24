/**
 * L-5b — publication: intents first, verified bytes, CAS promotion.
 *
 * Every commit records a `commit-release` intent before any external object
 * operation, verifies staged bytes by read-back (digest + size) before the
 * release is marked ready, and CAS-promotes the current release pointer. A
 * failed blob/DB step leaves the intent pending and nothing visible; a lost
 * CAS race is an explicit conflict (the loser's blobs stay addressable
 * orphans for L-5c GC, never a visible release). Repeating a request with
 * the same idempotency key returns the one stored release.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
  decidePublishAuthorization,
  createGuardedPublicationService,
  type GuardedPublicationDeps,
} from '../src/server/publication.js';
import type { ArtifactAcl } from '../src/server/access.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import { parseManifest } from '../src/codecs.js';
import { createMemoryLifecycleStore } from '../src/server/lifecycle.js';
import { createMemoryRefcountStore, createGcService } from '../src/server/gc.js';
import type { FinalizeRequest, FinalizeResult } from '../src/server/commit/types.js';

function guardedFixture(finalize: (request: FinalizeRequest) => Promise<FinalizeResult>) {
  const refs = createMemoryRefcountStore();
  const blobs = createMemoryBlobStore();
  const deps: GuardedPublicationDeps = {
    coordinator: { finalize, replayGuarded: finalize }, refs, blobs,
    intents: createMemoryIntentStore(), lifecycle: createMemoryLifecycleStore(),
    resolveAcl: async () => ({ ownerId: 'owner-1', grants: [], isPublic: false }),
    createUnitWriter: () => ({
      putRelease: async () => {}, registerBlob: async () => {},
      promoteCurrentLatestWins: async () => {}, completeIntent: async () => {},
      addReleaseRef: (digest, holder) => refs.addRef(digest, holder),
    }),
  };
  const input = {
    ownerId: 'owner-1', actorId: 'owner-1', storageScopeId: 'scope-1',
    artifactId: '11111111-1111-4111-8111-111111111111', profile: {},
    files: [{ path: 'index.html', mimeType: 'text/html', bytes: new Uint8Array([1]) }],
    policyRevision: 'rev-1', callerKey: 'key-1',
  };
  return { deps, refs, blobs, input };
}

describe('finalized publication regressions', () => {
  it('should protect active preparation while finalization waits', async () => {
    const f = guardedFixture(async () => {
      const report = await createGcService(f.refs).collect(f.blobs, 'artifacts/');
      expect(report.deleted).toEqual([]);
      expect(report.retained).toHaveLength(1);
      return { ok: false, failure: { commitState: 'not_committed' } } as FinalizeResult;
    });
    await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    expect((await createGcService(f.refs).collect(f.blobs, 'artifacts/')).deleted).toHaveLength(1);
  });

  it('should retain committed refs when COMMIT acknowledgement is lost', async () => {
    const f = guardedFixture(async (request) => {
      await request.provisional!({ query: async () => ({ rows: [], rowCount: 0 }) });
      return { ok: false, failure: { commitState: 'unknown' } } as FinalizeResult;
    });
    await createGuardedPublicationService(f.deps).publishFinalized(f.input);
    expect(await f.refs.count(`sha256:${createHash('sha256').update(f.input.files[0].bytes).digest('hex')}`)).toBe(1);
    const report = await createGcService(f.refs).collect(f.blobs, 'artifacts/');
    expect(report.deleted).toEqual([]);
    expect(report.retained).toHaveLength(1);
  });
});

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function makeService(blobs = createMemoryBlobStore()) {
  const intents = createMemoryIntentStore();
  const service = createPublicationService({
    state: createMemoryStateStore(),
    blobs,
    intents,
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
  });
  return { service, intents, blobs };
}

const PROFILE = { title: 'Hello', theme: 'light' };
const INPUT = {
  ownerId: 'owner-1',
  storageScopeId: 'scope-1',
  artifactId: '11111111-1111-4111-8111-111111111111',
  profile: PROFILE,
  files: [{ path: 'index.html', mimeType: 'text/html', bytes: owe([1, 2, 3]) }],
};

describe('publication', () => {
  it('commits a sealed release and serves it as current', async () => {
    const { service } = makeService();
    const { releaseId, manifest } = await service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    expect(releaseId).toMatch(/^[0-9a-f-]{36}$/);
    const parsed = parseManifest(manifest);
    expect(parsed.digest).toMatch(/^[0-9a-f]{64}$/);
    const current = await service.getCurrent(INPUT.artifactId);
    expect(current?.releaseId).toBe(releaseId);
    expect(current?.manifest).toBe(manifest);
  });

  it('leaves nothing visible when a blob step fails, intent stays pending', async () => {
    const failingBlobs = createMemoryBlobStore();
    const realPut = failingBlobs.putBlob.bind(failingBlobs);
    let calls = 0;
    failingBlobs.putBlob = async (key: string, bytes: Uint8Array) => {
      calls += 1;
      if (calls === 1) throw new Error('s3 exploded');
      return realPut(key, bytes);
    };
    const { service, intents } = makeService(failingBlobs);
    await expect(service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' })).rejects.toThrow(
      /s3 exploded/,
    );
    expect(await service.getCurrent(INPUT.artifactId)).toBeUndefined();
    const pending = await intents.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.kind).toBe('commit-release');
  });

  it('refuses a corrupt read-back and keeps the release invisible', async () => {
    const corruptBlobs = createMemoryBlobStore();
    const realGet = corruptBlobs.getBlob.bind(corruptBlobs);
    corruptBlobs.getBlob = async (key: string) => {
      const bytes = await realGet(key);
      if (bytes === undefined) return undefined;
      return owe([...bytes, 9]);
    };
    const { service } = makeService(corruptBlobs);
    await expect(service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' })).rejects.toThrow(
      /digest/,
    );
    expect(await service.getCurrent(INPUT.artifactId)).toBeUndefined();
  });

  it('resolves a commit race with one winner and an explicit conflict', async () => {
    const { service } = makeService();
    const first = service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    const second = service.publish({ ...INPUT, idempotencyKey: 'k-2', paramsHash: 'h-2' });
    const results = await Promise.allSettled([first, second]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won.length).toBe(1);
    expect(lost.length).toBe(1);
    expect(String((lost[0] as PromiseRejectedResult).reason)).toMatch(/conflict/);
    const current = await service.getCurrent(INPUT.artifactId);
    expect(won[0]?.status === 'fulfilled' ? won[0].value.releaseId : undefined).toBe(current?.releaseId);
  });

  it('repeats one request to one stored release', async () => {
    const { service } = makeService();
    const first = await service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    const second = await service.publish({ ...INPUT, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    expect(second.releaseId).toBe(first.releaseId);
  });
});

describe('publish authorization predicate', () => {
  const acl = (ownerId: string): ArtifactAcl => ({ ownerId, grants: [], isPublic: false });

  it('allows the owner on an active artifact', () => {
    expect(
      decidePublishAuthorization({ lifecycleState: 'active', acl: acl('owner-1'), actorId: 'owner-1' }),
    ).toEqual({ allowed: true });
  });

  it('denies a non-owner even on an active artifact', () => {
    expect(
      decidePublishAuthorization({ lifecycleState: 'active', acl: acl('owner-1'), actorId: 'intruder-9' }),
    ).toEqual({ allowed: false, reason: 'denied' });
  });

  it('denies a missing ACL closed', () => {
    expect(
      decidePublishAuthorization({ lifecycleState: 'active', acl: undefined, actorId: 'owner-1' }),
    ).toEqual({ allowed: false, reason: 'denied' });
  });

  it('revokes withdrawn artifacts and rejects terminal states', () => {
    expect(
      decidePublishAuthorization({ lifecycleState: 'withdrawn', acl: acl('owner-1'), actorId: 'owner-1' }),
    ).toEqual({ allowed: false, reason: 'revoked' });
    expect(
      decidePublishAuthorization({ lifecycleState: 'deleted', acl: acl('owner-1'), actorId: 'owner-1' }),
    ).toEqual({ allowed: false, reason: 'invalid_object' });
    expect(
      decidePublishAuthorization({ lifecycleState: 'purged', acl: acl('owner-1'), actorId: 'owner-1' }),
    ).toEqual({ allowed: false, reason: 'invalid_object' });
  });
});
