import { describe, expect, it, vi } from 'vitest';
import { SpeechCoordinator, createSession } from '../src/core/session.js';
import { commit, fixture, mutation, scope, TestJournal } from './fixtures.js';

describe('durable interruption', () => {
  it('should never start when Stop precedes native submission', async () => {
    const { core, control, stopPlayback } = fixture();
    const turn = await commit(core);
    const receipt = await core.interrupt(turn, 'stop-1');
    expect(stopPlayback).toHaveBeenCalledOnce();
    expect(receipt.coverage).toEqual(['delegate', 'exec', 'read']);
    expect(await core.send(turn)).toBe(false);
    expect(control.start).not.toHaveBeenCalled();
    expect(await core.status(turn)).toMatchObject({ phase: 'interrupted', terminal: 'cancelled-before-start' });
  });

  it('should dedupe Stop across restart and keep every enabled class fenced', async () => {
    const f = fixture();
    const turn = await commit(f.core);
    const first = await f.core.interrupt(turn, 'stop-1');
    const restarted = fixture(f.journal.restart());
    expect(await restarted.core.interrupt(turn, 'stop-1')).toEqual(first);
    expect(await restarted.core.interrupt(turn, 'stop-2')).toEqual(first);
    for (const toolClass of ['read', 'exec', 'delegate']) {
      await expect(restarted.core.admitTool(turn, { ...mutation(), toolClass })).rejects.toThrow('fenced');
    }
  });

  it('should bind a late native ID only to the tombstone and interrupt it', async () => {
    const f = fixture();
    let resolve!: (value: { nativeTurnId: string }) => void;
    vi.mocked(f.control.start).mockImplementation(() => new Promise(r => { resolve = r; }));
    const turn = await commit(f.core);
    const sending = f.core.send(turn);
    await vi.waitFor(() => expect(f.control.start).toHaveBeenCalledOnce());
    await f.core.interrupt(turn, 'stop-1');
    resolve({ nativeTurnId: 'late-native' });
    await sending;
    expect(f.control.interrupt).toHaveBeenCalledWith(expect.objectContaining({ nativeTurnId: 'late-native' }));
    expect((await f.core.status(turn)).phase).toBe('cancelling');
    await expect(commit(f.core, 'next')).rejects.toThrow('terminal');
  });

  it('should isolate completion racing Stop from the next epoch', async () => {
    const { core } = fixture();
    const old = await commit(core);
    await core.send(old);
    await core.complete(old, 'completed');
    const next = await commit(core, 'next');
    await core.interrupt(old, 'late-stop');
    await core.complete(old, 'interrupted');
    expect((await core.status(next)).phase).toBe('committed');
    expect(next.turnEpoch).toBe(old.turnEpoch + 1);
  });

  it('should query an uncertain start after restart without resubmitting', async () => {
    const f = fixture();
    vi.mocked(f.control.start).mockRejectedValue(new Error('lost ACK'));
    const turn = await commit(f.core);
    await expect(f.core.send(turn)).rejects.toThrow('lost ACK');
    const restarted = fixture(f.journal.restart());
    await restarted.core.recover(turn);
    expect(restarted.control.query).toHaveBeenCalledWith(turn);
    expect(await restarted.core.send(turn)).toBe(false);
    expect(restarted.control.start).not.toHaveBeenCalled();
  });

  it('should refuse an enabled class without an intercept', () => {
    expect(() => new TestJournal(createSession(scope, { native: 'read-only' }, [], []))).toThrow('coverage');
    expect(SpeechCoordinator).toBeDefined();
  });
});
