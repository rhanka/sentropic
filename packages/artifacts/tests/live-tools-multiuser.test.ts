import { expect, it } from 'vitest';
import { liveWitness } from './fixtures/live-world.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const text = (page: { files: { path: string; text: string }[] }, path: string) => page.files.find(f => f.path === path)?.text;

it('should keep an acknowledged edit when the worker is OOM-killed during projection', async () => {
  const w = liveWitness();
  w.worker.reconcile.mockRejectedValueOnce(new Error('OOMKilled'));
  const first = await w.write({ files: [{ path: 'ui/a.ts', text: 'acknowledged before the crash' }] });
  expect(first).toMatchObject({ workerPending: true, appliedRevision: null });
  await settle();
  expect(text(await w.call('live_read'), 'ui/a.ts')).toBe('acknowledged before the crash');
  const projected: string[] = [];
  w.worker.reconcile.mockImplementation(async identity => {
    projected.push((await w.store.transaction(identity, async tx => tx.record!)).revision); return undefined;
  });
  const second = await w.write({ files: [{ path: 'ui/b.ts', text: 'next' }] });
  await settle();
  expect(projected).toEqual([second.liveRevision]);
  const page = await w.call('live_read');
  expect([text(page, 'ui/a.ts'), text(page, 'ui/b.ts')]).toEqual(['acknowledged before the crash', 'next']);
});
it('should let an invited reader read the owner draft but never write, reset or read status', async () => {
  const w = liveWitness({ invited: actorId => actorId === 'bob' });
  await w.write({ files: [{ path: 'ui/a.ts', text: 'alice draft' }] });
  const state = await w.status(); let n = 0;
  const as = (actorId: string, operation: string, args: Record<string, unknown> = {}) => w.service.execute(operation,
    { artifactId: w.binding.artifactId, ...args }, { ...w.context, actorId, invocationId: `${actorId}-${++n}` });
  const guarded = { expectedHeadSha: state.currentHeadSha, expectedLiveRevision: state.liveRevision };
  expect(text(await as('bob', 'live_read'), 'ui/a.ts')).toBe('alice draft');
  await expect(as('carol', 'live_read')).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(as('bob', 'live_status')).rejects.toMatchObject({ kind: 'access_denied' });
  await expect(as('bob', 'live_write', { ...guarded, idempotencyKey: 'bob-1', files: [{ path: 'ui/a.ts', text: 'bob' }] }))
    .rejects.toMatchObject({ kind: 'access_denied' });
  await expect(as('bob', 'live_reset', { ...guarded, idempotencyKey: 'bob-2' })).rejects.toMatchObject({ kind: 'access_denied' });
  expect(text(await w.call('live_read'), 'ui/a.ts')).toBe('alice draft');
});
