import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextNodeEpoch, hostBudget } from '../src/node-state.js';

describe('agent-owned epoch and AMD-17 budget', () => {
  it('should advance durable epoch before accepting requests after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'epoch-'));
    try {
      expect(nextNodeEpoch(root)).toBe(1);
      expect(nextNodeEpoch(root)).toBe(2);
    } finally { rmSync(root, { recursive: true }); }
  });
  it('should preserve 2944 MiB at the measured 3819 MiB floor', () => {
    expect(hostBudget(4_005_416_960)).toMatchObject({ reservableMiB: 2944,
      hostMemory: { memTotalFloorMiB: 3819, unallocatedMarginMiB: 171, zramMemLimitMiB: 128 } });
    expect(hostBudget(3818 * 1048576).reservableMiB).toBe(2943);
  });
});
