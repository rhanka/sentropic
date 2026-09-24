import { describe, expect, it, vi } from 'vitest';
import { createH2aNhiLifecycle, type CommandResult } from '../src/index.js';

const success: CommandResult = { exitCode: 0, stdout: '{}', stderr: '' };

describe('h2a NHI lifecycle', () => {
  it.each(['', '  ', '-', '--root', ' --scope'])('should reject unsafe values before invoking h2a (%j)', async value => {
    const run = vi.fn(async () => success);
    const nhi = createH2aNhiLifecycle({ run });
    for (const argument of ['instance', 'role', 'scope'] as const) {
      await expect(nhi.attest({ instance: 'agent', privateKey: 'key', [argument]: value }))
        .rejects.toMatchObject({ name: 'InvalidNhiArgumentError', code: 'invalid_nhi_argument', argument });
    }
    await expect(nhi.offboard({ instance: value })).rejects.toMatchObject({ code: 'invalid_nhi_argument', argument: 'instance' });
    await expect(nhi.exportBundle({ instance: value, trustDomain: 'local.test' }))
      .rejects.toMatchObject({ code: 'invalid_nhi_argument', argument: 'instance' });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: 'AGENT' }, ['--role', 'AGENT']],
    [{ scope: 'workspace:one' }, ['--scope', 'workspace:one']],
    [{ role: 'AGENT', scope: 'workspace:one' }, ['--role', 'AGENT', '--scope', 'workspace:one']],
  ])('should forward optional attestation context without changing h2a outcomes (%j)', async (context, flags) => {
    const failure = { exitCode: 1, stdout: '', stderr: 'unauthorized scope' };
    const run = vi.fn(async () => failure);
    const nhi = createH2aNhiLifecycle({ run });
    await expect(nhi.attest({ instance: 'agent', privateKey: 'key', root: '/root', ...context })).resolves.toBe(failure);
    expect(run).toHaveBeenCalledWith('h2a', [
      'nhi', 'attest', '--instance', 'agent', '--private-key', 'key', ...flags, '--root', '/root',
    ]);
    run.mockResolvedValueOnce(success);
    await expect(nhi.attest({ instance: 'agent', privateKey: 'key', ...context })).resolves.toBe(success);
    run.mockRejectedValueOnce(new Error('runner unavailable'));
    await expect(nhi.attest({ instance: 'agent', privateKey: 'key', ...context })).rejects.toThrow('runner unavailable');
  });

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
