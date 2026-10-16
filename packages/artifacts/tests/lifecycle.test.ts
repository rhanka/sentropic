/**
 * L-5c — lifecycle: withdraw/restore/delete/purge, promote/rollback, renew.
 *
 * Artifact states run active → withdrawn → active (restore) or → deleted →
 * active (undo) → purged (terminal). Purged UUIDs never resurrect and their
 * releases go terminal with a dereference report for GC. Promotion and
 * rollback are explicit CAS moves; a replay against a retired (non-current)
 * release returns the stored result without touching current. Renew touches
 * eligibility-checked artifacts only. Every mutation is owner-only.
 */
import { describe, expect, it } from 'vitest';
import {
  createLifecycleService,
  createMemoryLifecycleStore,
  type ArtifactState,
} from '../src/server/lifecycle.js';
import {
  createPublicationService,
  createMemoryStateStore,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import type { ArtifactAcl } from '../src/server/access.js';

const OWNER = 'owner-1';
const OTHER = 'owner-2';
const ACL: ArtifactAcl = { ownerId: OWNER, isPublic: false, withdrawn: false, grants: [] };

async function makeLife() {
  const store = createMemoryLifecycleStore();
  const service = createLifecycleService(store, () => '2026-01-01T00:00:00.000Z');
  const id = '11111111-1111-4111-8111-111111111111';
  // Like production (ensureArtifact before any lifecycle step), the artifact
  // is registered with its owner first; states default to active.
  await store.register(id, OWNER);
  return { store, service, id };
}

describe('artifact lifecycle', () => {
  it('runs withdraw/restore/delete/undo/purge with terminal purge', async () => {
    const { service, id } = await makeLife();
    expect(await service.stateOf(id)).toBe('active');
    await service.withdraw(id, OWNER);
    expect(await service.stateOf(id)).toBe('withdrawn');
    expect(service.canRead({ artifactId: id, state: await service.stateOf(id) }, ACL, OWNER)).toBe(true);
    expect(service.canRead({ artifactId: id, state: 'withdrawn' as ArtifactState }, ACL, OTHER)).toBe(false);
    await service.restore(id, OWNER);
    expect(await service.stateOf(id)).toBe('active');
    await service.deleteArtifact(id, OWNER);
    expect(await service.stateOf(id)).toBe('deleted');
    await service.restore(id, OWNER);
    expect(await service.stateOf(id)).toBe('active');
    await service.deleteArtifact(id, OWNER);
    const report = await service.purge(id, OWNER, ['sha256:aa']);
    expect(report).toEqual({ artifactId: id, purgedReleases: [], blobDigests: ['sha256:aa'] });
    expect(await service.stateOf(id)).toBe('purged');
    await expect(service.restore(id, OWNER)).rejects.toThrow(/terminal/);
    await expect(service.deleteArtifact(id, OWNER)).rejects.toThrow(/terminal/);
  });

  it('refuses mutations by non-owners', async () => {
    const { service, id } = await makeLife();
    await expect(service.withdraw(id, OTHER)).rejects.toThrow(/access denied/);
    await expect(service.deleteArtifact(id, OTHER)).rejects.toThrow(/access denied/);
    await expect(service.purge(id, OWNER, [])).rejects.toThrow(/deleted/);
  });

  it('promotes and rolls back with explicit CAS', async () => {
    const { store, service, id } = await makeLife();
    await store.setRelease(id, 'r-1');
    await store.setRelease(id, 'r-2');
    await store.setCurrent(id, 'r-1');
    await service.promote(id, OWNER, 'r-2', 'r-1');
    expect(await store.getCurrent(id)).toBe('r-2');
    expect(await store.getReleaseState('r-1')).toBe('retired');
    await expect(service.promote(id, OWNER, 'r-1', 'r-1')).rejects.toThrow(/conflict/);
    await service.promote(id, OWNER, 'r-1', 'r-2');
    expect(await store.getCurrent(id)).toBe('r-1');
  });

  it('keeps replays against retired releases terminal', async () => {
    const state = createMemoryStateStore();
    const publication = createPublicationService({
      state,
      blobs: createMemoryBlobStore(),
      intents: createMemoryIntentStore(),
      idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
    });
    const input = {
      ownerId: OWNER,
      storageScopeId: 'scope-1',
      artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      profile: {},
      files: [{ path: 'a.html', mimeType: 'text/html', bytes: new Uint8Array([1]) }],
    };
    const first = await publication.publish({ ...input, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    const second = await publication.publish({ ...input, idempotencyKey: 'k-2', paramsHash: 'h-2' });
    expect(second.releaseId).not.toBe(first.releaseId);
    const replayed = await publication.publish({ ...input, idempotencyKey: 'k-1', paramsHash: 'h-1' });
    expect(replayed.releaseId).toBe(first.releaseId);
    expect((await publication.getCurrent(input.artifactId))?.releaseId).toBe(second.releaseId);
  });

  it('renews eligible artifacts and refuses terminal ones', async () => {
    const { service, id } = await makeLife();
    const touched = await service.renew(id, OWNER);
    expect(touched.renewedAt).toBe('2026-01-01T00:00:00.000Z');
    await service.deleteArtifact(id, OWNER);
    await expect(service.renew(id, OWNER)).rejects.toThrow(/deleted/);
  });
});
