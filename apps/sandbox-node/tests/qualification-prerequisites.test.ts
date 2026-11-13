import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { qualificationPrerequisites } from '../src/qualification-prerequisites.js';
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../src/file-digest.js', () => ({ fileDigest: () => 'a'.repeat(64) }));
afterEach(() => vi.restoreAllMocks());

describe('qualification receipt and hardened prerequisites', () => {
  it.each([false, true])('should execute prerequisites under unit restrictions and fail clearly (%s)', fail => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(readFileSync).mockImplementation(path => String(path).endsWith('.service')
      ? 'CapabilityBoundingSet=CAP_SYS_ADMIN CAP_NET_ADMIN\nSystemCallFilter=@system-service unshare\n' : 'pinned runsc');
    vi.mocked(execFileSync).mockImplementation(file => {
      if (file === 'sh') return '/opt/gvisor/runsc';
      if (fail) throw new Error('operation denied');
      return '';
    });
    const run = () => qualificationPrerequisites(`/opt/execution-node/releases/${'a'.repeat(64)}`);
    if (fail) expect(run).toThrow('iproute2 (ip), util-linux (unshare), and POSIX sh');
    else run();
    expect(execFileSync).toHaveBeenCalledWith('systemd-run', expect.arrayContaining([
      '--property=CapabilityBoundingSet=CAP_SYS_ADMIN CAP_NET_ADMIN',
      '--property=SystemCallFilter=@system-service unshare',
    ]), expect.objectContaining({ timeout: 10000, killSignal: 'SIGKILL' }));
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^RECEIPT archive_sha256=a{64} runsc_sha256=[a-f0-9]{64}$/));
  });
});
