import { describe, expect, it } from 'vitest';
import type { GitBinding, GitBindingStore, GitBindingWrite } from '../../src/server/git-bindings.js';

export const gitBinding = (artifactId = '11111111-1111-4111-8111-111111111111',
  storageScopeId = 'scope-a', branch = 'artifact/shared/demo'): GitBinding => ({
  artifactId, storageScopeId, repoId: 'repo-a', branch, channel: 'shared', personalPrincipalId: null,
  subPath: '', baseCommitSha: 'a'.repeat(40), headCommitSha: 'a'.repeat(40), releaseCommitSha: null,
  autoPublish: false, executor: 'caller', pendingJobId: null, pendingCommitSha: null,
  state: 'attached', generation: 1, version: 1, attachedBy: 'alice',
  attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z',
});
export const gitWrite = (binding = gitBinding(), key = 'attach'): GitBindingWrite => ({
  binding, expectedVersion: null, actorId: 'alice', idempotencyKey: key, commandHash: key,
  event: { action: 'attach', afterSha: binding.headCommitSha ?? undefined },
});

export function gitBindingConformance(name: string, fresh: () => Promise<GitBindingStore>) {
  describe(name, () => {
    it('should retain audit and served SHA through pause, resume, detach and reattach', async () => {
      const store = await fresh();
      let binding = { ...gitBinding(), releaseCommitSha: 'b'.repeat(40) };
      await store.write(gitWrite(binding));
      for (const [action, state, generation] of [
        ['pause', 'paused', 2], ['resume', 'attached', 2], ['detach', 'detached', 3],
        ['attach', 'attached', 4],
      ] as const) {
        const expectedVersion = binding.version;
        binding = { ...binding, state, generation, version: expectedVersion + 1 };
        await store.write({ ...gitWrite(binding, action + generation), expectedVersion, event: { action } });
        expect(await store.get('scope-a', binding.artifactId)).toEqual(binding);
      }
      expect((await store.events('scope-a', binding.artifactId)).map(e => e.action))
        .toEqual(['attach', 'pause', 'resume', 'detach', 'attach']);
    });

    it('should refuse another active binding on the same artifact or branch', async () => {
      const store = await fresh();
      await store.write(gitWrite());
      await expect(store.write(gitWrite({ ...gitBinding(), branch: 'artifact/shared/other' }, 'other')))
        .rejects.toMatchObject({ kind: 'git_binding_conflict' });
      await expect(store.write(gitWrite(gitBinding('22222222-2222-4222-8222-222222222222'), 'second')))
        .rejects.toMatchObject({ kind: 'git_binding_conflict' });
      expect(await store.events('scope-a', gitBinding().artifactId)).toHaveLength(1);
    });

    it('should isolate reads, writes, events and replay keys across scopes', async () => {
      const store = await fresh();
      await store.write(gitWrite());
      const id = gitBinding().artifactId;
      expect(await store.get('scope-b', id)).toBeUndefined();
      expect(await store.events('scope-b', id)).toEqual([]);
      await expect(store.write(gitWrite(gitBinding(id, 'scope-b'), 'foreign')))
        .rejects.toMatchObject({ kind: 'not_found' });
      const other = gitBinding('33333333-3333-4333-8333-333333333333', 'scope-b', 'artifact/shared/other');
      expect((await store.write(gitWrite(other))).replayed).toBe(false);
    });

    it('should replay once and refuse key reuse with a different command', async () => {
      const store = await fresh();
      const first = await store.write(gitWrite());
      expect(first.replayed).toBe(false);
      expect(await store.write(gitWrite())).toEqual({ ...first, replayed: true });
      await expect(store.write({ ...gitWrite(), commandHash: 'different' }))
        .rejects.toMatchObject({ kind: 'command_conflict' });
      expect(await store.events('scope-a', gitBinding().artifactId)).toHaveLength(1);
    });

    it('should fence stale CAS and keep mutation and audit atomic', async () => {
      const store = await fresh();
      const binding = gitBinding();
      await store.write(gitWrite());
      const paused = { ...binding, state: 'paused' as const, version: 2, generation: 2 };
      await expect(store.write({ ...gitWrite(paused, 'stale'), expectedVersion: 0, event: { action: 'pause' } }))
        .rejects.toMatchObject({ kind: 'pointer_conflict' });
      expect(await store.get('scope-a', binding.artifactId)).toEqual(binding);
      expect(await store.events('scope-a', binding.artifactId)).toHaveLength(1);
    });

    it('should elect one concurrent branch claimant', async () => {
      const store = await fresh();
      const outcomes = await Promise.allSettled([store.write(gitWrite()), store.write(gitWrite(
        gitBinding('22222222-2222-4222-8222-222222222222'), 'race'))]);
      expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
    });

    it('should refuse out-of-namespace refs without an audit or receipt', async () => {
      const store = await fresh();
      await expect(store.write(gitWrite({ ...gitBinding(), branch: 'main' })))
        .rejects.toMatchObject({ kind: 'git_ref_not_allowed' });
      expect(await store.get('scope-a', gitBinding().artifactId)).toBeUndefined();
      expect(await store.events('scope-a', gitBinding().artifactId)).toEqual([]);
      expect((await store.write(gitWrite())).replayed).toBe(false);
    });

    it('should allow a detached branch to be reclaimed while retaining its old row', async () => {
      const store = await fresh();
      await store.write(gitWrite());
      await store.write({ ...gitWrite({ ...gitBinding(), state: 'detached', version: 2, generation: 2 }, 'detach'),
        expectedVersion: 1, event: { action: 'detach' } });
      await store.write(gitWrite(gitBinding('22222222-2222-4222-8222-222222222222'), 'reclaim'));
      expect(await store.get('scope-a', gitBinding().artifactId)).toMatchObject({ state: 'detached' });
    });

    it('should refuse inbound resume and retain a missing-branch condition through pause', async () => {
      const store = await fresh();
      await store.write(gitWrite());
      const missing = { ...gitBinding(), state: 'diverged' as const, stateDetail: 'git_branch_missing',
        generation: 2, version: 2 };
      await store.write({ ...gitWrite(missing, 'missing'), expectedVersion: 1, event: { action: 'inbound' } });
      const paused = { ...missing, state: 'paused' as const, version: 3, generation: 3 };
      await store.write({ ...gitWrite(paused, 'pause'), expectedVersion: 2, event: { action: 'pause' } });
      for (const action of ['resume', 'inbound'] as const) {
        await expect(store.write({ ...gitWrite({ ...paused, state: 'attached', stateDetail: undefined,
          version: 4 }, action), expectedVersion: 3, event: { action } }))
          .rejects.toMatchObject({ kind: 'invalid_request' });
      }
      expect(await store.get('scope-a', gitBinding().artifactId)).toEqual(paused);
    });
  });
}
