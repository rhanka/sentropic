import { expect, it } from 'vitest';
import { createArtifactCommitBarrier } from '../src/testing.js';

it('should hold an explicitly armed arrival before a late waiter subscribes', async () => {
  const barrier = createArtifactCommitBarrier({ points: ['before_commit'] });
  let resumed = false;
  const pending = barrier.observer('before_commit', 'late').then(() => { resumed = true; });
  await Promise.resolve();
  await barrier.waitUntilReached('before_commit', 'late');
  expect(resumed).toBe(false);
  barrier.release('before_commit', 'late');
  await pending;
  expect(resumed).toBe(true);
});

it('should observe unarmed points without holding unrelated invocations', async () => {
  const barrier = createArtifactCommitBarrier({ points: ['before_commit'] });
  await barrier.observer('before_key_lock', 'other');
  await barrier.waitUntilReached('before_key_lock', 'other');
});
