import { describe, expect, it, vi } from 'vitest';
import { createH2aNhiLifecycle, type CommandResult } from '../src/index.js';

const success: CommandResult = { exitCode: 0, stdout: '{}', stderr: '' };

describe('h2a NHI lifecycle', () => {
  it('should map attest, offboard and export to exact h2a nhi commands', async () => {
    const run = vi.fn(async () => success);
    const nhi = createH2aNhiLifecycle({ run });

    await nhi.attest({
      instance: 'codex:cluster:abc123',
      privateKey: '/keys/cluster.pem',
      root: '/mesh/.h2a',
    });
    await nhi.offboard({ instance: 'codex:cluster:abc123', root: '/mesh/.h2a' });
    await nhi.exportBundle({
      instance: 'codex:cluster:abc123',
      trustDomain: 'sentropic.example',
    });

    expect(run).toHaveBeenNthCalledWith(1, 'h2a', [
      'nhi', 'attest', '--instance', 'codex:cluster:abc123',
      '--private-key', '/keys/cluster.pem', '--root', '/mesh/.h2a',
    ]);
    expect(run).toHaveBeenNthCalledWith(2, 'h2a', [
      'nhi', 'offboard', '--instance', 'codex:cluster:abc123', '--root', '/mesh/.h2a',
    ]);
    expect(run).toHaveBeenNthCalledWith(3, 'h2a', [
      'nhi', 'export', '--instance', 'codex:cluster:abc123',
      '--trust-domain', 'sentropic.example',
    ]);
  });

  it('should return the h2a command result without interpreting its payload', async () => {
    const run = vi.fn(async () => success);
    const nhi = createH2aNhiLifecycle({ run });

    await expect(nhi.offboard({ instance: 'agent:1' })).resolves.toBe(success);
  });
});
