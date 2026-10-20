import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { grantFor } from './authority-corpus.js';

describe('verified journal scan boundaries', () => {
  it('should refuse checkpointing an unread prefix after a caller jumps its read position', async () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const bound = root.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
    for (let n = 0; n < 3; n += 1) await bound.appendChain(`c-${n}`, { id: `r-${n}`, hash: `h-${n}`, bytes: '{}' }, { kind: 'absent', allocation: '0' });
    const fence = await bound.journalFence();
    expect((await bound.journalRead('jump', 2, 1)).events).toHaveLength(1);
    await expect(bound.journalCheckpoint('jump', 0, 3, fence)).rejects.toMatchObject({ code: 'invalid-command' });
    await bound.journalRead('jump', 0, 2);
    await bound.journalRead('jump', 2, 1);
    await bound.journalCheckpoint('jump', 0, 3, fence);
    expect((await bound.journalInspect('jump')).cursor).toBe(3);
  });
});
