import { expect, it } from 'vitest';
import { liveWitness } from './fixtures/live-world.js';
import { ArtifactOperationError } from '../src/server/failures.js';

it('should admit only one concurrent edit and keep reset replay from deleting a newer draft', async () => {
  const w = liveWitness(); const state = await w.status();
  const args = { expectedHeadSha: state.baseHeadSha, expectedLiveRevision: state.liveRevision };
  const raced = await Promise.allSettled(['one', 'two'].map(text => w.call('live_write', { ...args,
    idempotencyKey: text, files: [{ path: 'ui/a.ts', text }] })));
  expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const beforeReset = await w.status();
  const reset = { expectedHeadSha: beforeReset.baseHeadSha, expectedLiveRevision: beforeReset.liveRevision, idempotencyKey: 'reset' };
  await w.call('live_reset', reset);
  await w.write({ files: [{ path: 'ui/a.ts', text: 'retained newer draft' }] });
  const projections = w.worker.reconcile.mock.calls.length;
  expect(await w.call('live_reset', reset)).toMatchObject({ replayed: true });
  expect(w.worker.reconcile).toHaveBeenCalledTimes(projections);
  expect((await w.call('live_read')).files[0].text).toBe('retained newer draft');
});
it('should freeze source while a commit is indeterminate and replay a lost forge response once', async () => {
  const w = liveWitness(); await w.write({ files: [{ path: 'ui/a.ts', text: 'frozen' }] });
  const state = await w.status();
  let parent: string; let tree: string; let invocation: string;
  w.git.commit.mockImplementationOnce(async input => {
    parent = input.expectedHeadSha; tree = state.liveTreeSha; invocation = input.invocationId;
    w.setHead('c'.repeat(40)); throw new ArtifactOperationError('provider_unavailable');
  });
  const args = { expectedHeadSha: state.baseHeadSha, files: [{ path: 'ui/a.ts', text: 'frozen' }],
    idempotencyKey: 'commit-loss', message: 'Commit exact draft' };
  await expect(w.call('git_commit', args)).rejects.toThrow();
  await expect(w.write({ files: [{ path: 'ui/b.ts', text: 'must wait' }] })).rejects.toMatchObject({ kind: 'git_live_conflict' });
  w.git.inspectCommit.mockImplementation(async () => ({ sha: 'c'.repeat(40), treeSha: tree, parents: [parent],
    message: `Commit exact draft\n\nArtifacts-Invocation: ${invocation}`,
    author: { name: 'Alice', email: 'alice@example.test' }, committer: { name: 'App', email: 'app@example.test' } }));
  expect(await w.call('git_commit', args)).toMatchObject({ commitSha: 'c'.repeat(40) });
  expect(await w.call('git_commit', args)).toMatchObject({ commitSha: 'c'.repeat(40), replayed: true });
  expect(w.git.commit).toHaveBeenCalledTimes(1);
  expect((await w.status()).dirty).toBe(false);
});
it('should stop after code-right revocation without source revision access or draft deletion', async () => {
  const w = liveWitness(); const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'retained' }] });
  w.revoke();
  expect(await w.call('live_control', { action: 'stop', liveSessionId: written.liveSessionId, idempotencyKey: 'stop' }))
    .toEqual({ liveSessionId: written.liveSessionId, state: 'DORMANT' });
  await expect(w.call('live_read')).rejects.toMatchObject({ kind: 'access_denied' });
  expect(w.worker.stop).toHaveBeenCalledTimes(1);
});
it('should refuse no-op commits and allow deleting an uncommitted new file', async () => {
  const w = liveWitness(); const state = await w.status();
  await expect(w.call('git_commit', { expectedHeadSha: state.baseHeadSha, files: [{ path: 'ui/a.ts', text: 'alpha' }],
    message: 'No change', idempotencyKey: 'no-op' })).rejects.toMatchObject({ kind: 'git_live_no_changes' });
  await w.write({ files: [{ path: 'ui/new.ts', text: 'temporary' }] });
  await w.write({ deletes: ['ui/new.ts'] });
  expect((await w.status()).dirty).toBe(false);
});
