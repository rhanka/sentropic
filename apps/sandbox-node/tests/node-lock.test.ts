import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireNodeLock } from '../src/node-lock.js';

describe('agent/qualification mutual exclusion', () => {
  it('should exclude a concurrent agent or qualification and release the kernel lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-lock-'));
    try {
      const path = join(root, 'lock'), release = await acquireNodeLock(path);
      await expect(acquireNodeLock(path)).rejects.toThrow('lock unavailable');
      release();
      // flock holds the lock until its pipe child has actually exited.
      const retry = async (): Promise<() => void> => {
        for (let i = 0; i < 100; i++) {
          try { return await acquireNodeLock(path); } catch { await new Promise(resolve => setTimeout(resolve, 5)); }
        }
        throw new Error('lock not released');
      };
      (await retry())();
    } finally { rmSync(root, { recursive: true }); }
  });
});
