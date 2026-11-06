import { describe, expect, it } from 'vitest';
import { liveWitness } from './fixtures/live-world.js';
describe('A-LIVE authoritative tree', () => {
  it('should persist edits without committing and expose the complete commit recipe', async () => {
    const w = liveWitness();
    const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'new text' }], deletes: ['ui/b.ts'] });
    expect(written.durableRevision).toBe(written.liveRevision);
    expect(written.appliedRevision).toBeNull();
    expect(w.git.commit).not.toHaveBeenCalled();
    const diff = await w.call('live_status', { includeDiff: true });
    expect(diff.files).toEqual([{ path: 'ui/a.ts', text: 'new text' }]);
    expect(diff.deletes).toEqual(['ui/b.ts']);
    expect((await w.call('live_read')).files).toEqual([{ path: 'ui/a.ts', text: 'new text', mode: '100644', encoding: 'utf-8' }]);
  });
  it('should reject duplicate/mixed paths and refused A1 paths before any forge call', async () => {
    const w = liveWitness(); await w.status(); w.git.resolveRef.mockClear();
    await expect(w.write({ files: [{ path: 'ui/package-lock.json', text: '{}' }] })).rejects.toMatchObject({ kind: 'git_path_refused' });
    await expect(w.write({ files: [{ path: 'ui/a.ts', text: 'new' }], deletes: ['ui/a.ts'] })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(w.git.commit).not.toHaveBeenCalled();
  });
  it('should refuse partial commits, then commit exactly the full live delta', async () => {
    const w = liveWitness();
    await w.write({ files: [{ path: 'ui/a.ts', text: 'new' }], deletes: ['ui/b.ts'] });
    const input = { expectedHeadSha: 'a'.repeat(40), message: 'Update view', idempotencyKey: 'commit-1' };
    await expect(w.call('git_commit', { ...input, files: [{ path: 'ui/a.ts', text: 'new' }] }))
      .rejects.toMatchObject({ kind: 'git_live_snapshot_mismatch' });
    expect(w.git.commit).not.toHaveBeenCalled();
    await w.call('git_commit', { ...input, deletes: ['ui/b.ts'], files: [{ path: 'ui/a.ts', text: 'new' }] });
    expect(w.git.commit).toHaveBeenCalledTimes(1);
    expect((await w.status()).dirty).toBe(false);
  });
  it('should retain dirty source across external head movement and permit explicit reset', async () => {
    const w = liveWitness(); await w.write({ files: [{ path: 'ui/a.ts', text: 'retained' }] });
    w.setHead('f'.repeat(40));
    const state = await w.status();
    expect(state.baseHeadSha).toBe('a'.repeat(40));
    expect(state.currentHeadSha).toBe('f'.repeat(40));
    await expect(w.write({ files: [{ path: 'ui/a.ts', text: 'lost' }] })).rejects.toMatchObject({ kind: 'git_live_draft_conflict' });
    await w.call('live_reset', { expectedHeadSha: 'f'.repeat(40), expectedLiveRevision: state.liveRevision, idempotencyKey: 'reset' });
    expect((await w.status()).dirty).toBe(false);
  });
});
