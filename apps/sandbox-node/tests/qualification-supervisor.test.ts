import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { superviseQualification, terminateQualification } from '../src/qualification-supervisor.js';

describe('qualification wall-clock supervisor', () => {
  it('should preserve the flock helper during graceful stop and kill the group only after grace', () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn(() => true) }) as unknown as ChildProcess;
    const groupKill = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      terminateQualification(child, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM'); expect(groupKill).not.toHaveBeenCalled();
      terminateQualification(child, 'SIGKILL'); expect(groupKill).toHaveBeenCalledExactlyOnceWith(-123, 'SIGKILL');
    } finally { vi.restoreAllMocks(); }
  });
  it.each(['deadline', 'SIGTERM'])('should hard-stop a blocked worker after its cleanup grace on %s', async cause => {
    vi.useFakeTimers();
    const baseline = process.listenerCount('SIGTERM');
    const child = new EventEmitter() as ChildProcess;
    const terminate = vi.fn((_child, signal) => { if (signal === 'SIGKILL') child.emit('exit', null, signal); });
    const work = superviseQualification(120_000, () => child, terminate);
    const result = expect(work).rejects.toThrow('worker failed');
    try {
      if (cause === 'deadline') await vi.advanceTimersByTimeAsync(120_000);
      else process.emit('SIGTERM');
      expect(terminate).toHaveBeenCalledExactlyOnceWith(child, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(10_000); await result;
      expect(terminate).toHaveBeenLastCalledWith(child, 'SIGKILL');
      expect(process.listenerCount('SIGTERM')).toBe(baseline);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('should accept a successful worker and dispose its watchdogs', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as ChildProcess;
    const terminate = vi.fn();
    try {
      const work = superviseQualification(120_000, () => child, terminate); child.emit('exit', 0);
      await work; expect(terminate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
