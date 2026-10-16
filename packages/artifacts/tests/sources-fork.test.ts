/**
 * L-5c — sources and private forks (spec-v8 §9 5c).
 *
 * A source is explicit inline-original provenance, a base commit, or a build
 * recipe — validated at attach time, never inferred. A fork creates a
 * private independent artifact under a fresh UUID: the manifest content is
 * copied, the ACL is not (the forker becomes sole owner), blobs stay shared
 * by reference counting, and provenance records the origin release. Forking
 * a deleted or purged artifact is refused; a fork never resurrects its
 * parent and the parent's later withdrawal never disables the fork.
 */
import { describe, expect, it } from 'vitest';
import { attachSource, type SourceRef } from '../src/server/sources.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';

describe('sources', () => {
  it('accepts inline-original, base commits and recipes', () => {
    expect(attachSource({ kind: 'inline-original' })).toEqual({ kind: 'inline-original' });
    expect(attachSource({ kind: 'base-commit', commit: 'abc123' })).toEqual({
      kind: 'base-commit',
      commit: 'abc123',
    });
    const recipe: SourceRef = { kind: 'recipe', steps: ['build', 'bundle'] };
    expect(attachSource(recipe)).toEqual(recipe);
  });

  it('refuses empty commits, empty recipes and unknown kinds', () => {
    expect(() => attachSource({ kind: 'base-commit', commit: '' })).toThrow(/commit/);
    expect(() => attachSource({ kind: 'recipe', steps: [] })).toThrow(/steps/);
    expect(() => attachSource({ kind: 'tarball' } as unknown as SourceRef)).toThrow(/kind/);
  });
});

function makeFork() {
  const store = createMemoryForkStore();
  const service = createForkService(store);
  const parent = '11111111-1111-4111-8111-111111111111';
  store.seed({
    artifactId: parent,
    ownerId: 'owner-1',
    releaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    manifest: '{"schemaVersion":"artifacts/v1"}',
    state: 'active',
    readerIds: ['reader-1'],
    blobDigests: ['sha256:aa'],
  });
  return { store, service, parent };
}

describe('private forks', () => {
  it('creates an independent artifact under a fresh UUID', async () => {
    const { store, service, parent } = makeFork();
    const fork = await service.fork({ actorId: 'reader-1', artifactId: parent });
    expect(fork.artifactId).not.toBe(parent);
    expect(fork.ownerId).toBe('reader-1');
    expect(fork.origin).toEqual({
      artifactId: parent,
      releaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(store.refcount('sha256:aa')).toBe(2);
  });

  it('copies no ACL: the parent reader set stays behind', async () => {
    const { store, service, parent } = makeFork();
    const fork = await service.fork({ actorId: 'reader-1', artifactId: parent });
    expect(store.readers(fork.artifactId)).toEqual([]);
    expect(store.readers(parent)).toEqual(['reader-1']);
  });

  it('refuses forks of deleted or purged artifacts', async () => {
    const { service, parent } = makeFork();
    await service.setState(parent, 'deleted');
    await expect(service.fork({ actorId: 'reader-1', artifactId: parent })).rejects.toThrow(
      /deleted/,
    );
    await service.setState(parent, 'purged');
    await expect(service.fork({ actorId: 'reader-1', artifactId: parent })).rejects.toThrow(
      /purged/,
    );
  });

  it('keeps the fork usable after parent withdrawal and never resurrects', async () => {
    const { store, service, parent } = makeFork();
    const fork = await service.fork({ actorId: 'reader-1', artifactId: parent });
    await service.setState(parent, 'deleted');
    expect((await store.get(fork.artifactId))?.state).toBe('active');
    await expect(service.fork({ actorId: 'reader-1', artifactId: parent })).rejects.toThrow();
    expect((await store.get(parent))?.state).toBe('deleted');
  });
});
